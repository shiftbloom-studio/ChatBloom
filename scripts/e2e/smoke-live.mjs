// Smoke test of the chat relay with real chat: connects overlays through `/api/irc` of a running
// Petal to channels that are busy right now, and compares a few of them with a direct
// connection to Twitch. Works against local workerd and against the deployed site.
//
// It reports counts and timings only. Message ids are held in memory while it runs, to find
// lost and duplicated lines; chat text, user names and channel names are neither kept nor
// printed.
//
//   SMOKE_URL             where Petal runs, for example https://petal.shiftbloom.studio
//   SMOKE_CHANNELS        candidate channels, separated by commas, or
//   SMOKE_CHANNELS_FILE   a file with one candidate channel per line
//
// Optional:
//   SMOKE_CLIENTS         overlays to connect, default 20. With fewer busy channels than
//                         overlays, several overlays share a channel.
//   SMOKE_SECONDS         how long the overlays listen, default 60
//   SMOKE_PROBE_SECONDS   how long the candidates are observed directly on Twitch to find
//                         the busy ones, default 10. 0 takes the candidates as they come.
//   SMOKE_DIRECT          channels that also get a direct connection to compare with,
//                         default 3
//
// Exits with 1 when an overlay got no JOIN echo in time, lost its socket, or saw a line twice,
// or when the relay lost lines that the direct connection delivered; with 2 when the test
// could not run.
import { readFile } from "node:fs/promises";

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const CHANNEL = /^[a-z0-9_]{1,25}$/;

/** After this long without a JOIN echo the browser client gives up on the relay. */
const JOIN_ECHO_LIMIT_MS = 15_000;
const OPEN_LIMIT_MS = 10_000;
const KEEP_ALIVE_MS = 20_000;
const KEEP_ALIVE = "PING :petal";
const KEEP_ALIVE_ANSWER = ":tmi.twitch.tv PONG tmi.twitch.tv :petal";
/**
 * What OBS sends. The relay refuses clients that send no user agent or that of a tool, the way
 * the chat pages do, and so does the rule on the zone.
 */
const AS_OVERLAY = {
    headers: {
        "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/127.0.0.0 Safari/537.36 OBS/31.0.3",
    },
};

/** Twitch allows 20 JOINs per 10 seconds on a connection; probing joins once and stays below. */
const PROBE_CHANNELS_PER_CONNECTION = 18;
/** Twitch also limits logins per address; more candidates than these are not observed. */
const PROBE_CONNECTIONS = 10;

/** Lines that arrive while one side is still joining or already leaving cannot be compared. */
const COMPARE_MARGIN_MS = 2000;

class SetupError extends Error {}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readSettings() {
    const number = (name, fallback) => {
        const value = Number(process.env[name] ?? fallback);
        if (!Number.isInteger(value) || value < 0) {
            throw new SetupError(`${name} is not a whole number`);
        }
        return value;
    };
    const target = process.env.SMOKE_URL;
    if (!target) throw new SetupError("SMOKE_URL is not set");
    let origin;
    try {
        origin = new URL(target);
    } catch {
        throw new SetupError("SMOKE_URL is not an address");
    }
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        throw new SetupError("SMOKE_URL must start with http:// or https://");
    }

    let listed = process.env.SMOKE_CHANNELS ?? "";
    if (process.env.SMOKE_CHANNELS_FILE) {
        listed = await readFile(process.env.SMOKE_CHANNELS_FILE, "utf8").catch(() => {
            throw new SetupError("SMOKE_CHANNELS_FILE cannot be read");
        });
    }
    const names = listed.split(/[\s,]+/).map((name) => name.replace(/^#/, "").toLowerCase());
    const candidates = [...new Set(names.filter((name) => CHANNEL.test(name)))];
    if (candidates.length === 0) {
        throw new SetupError("SMOKE_CHANNELS or SMOKE_CHANNELS_FILE must name channels");
    }
    const clients = number("SMOKE_CLIENTS", 20);
    if (clients === 0) throw new SetupError("SMOKE_CLIENTS must be at least 1");
    return {
        origin: origin.origin,
        socketOrigin: origin.origin.replace(/^http/, "ws"),
        candidates,
        clients,
        seconds: number("SMOKE_SECONDS", 60),
        probeSeconds: number("SMOKE_PROBE_SECONDS", 10),
        direct: number("SMOKE_DIRECT", 3),
    };
}

/** What is needed of a line to count it; the line itself is dropped by the caller. */
function inspect(line) {
    let tags = "";
    let rest = line;
    if (line.startsWith("@")) {
        const end = line.indexOf(" ");
        tags = line.slice(1, end);
        rest = line.slice(end + 1);
    }
    if (rest.startsWith(":")) rest = rest.slice(rest.indexOf(" ") + 1);
    const end = rest.indexOf(" ");
    const command = end === -1 ? rest : rest.slice(0, end);
    let id;
    let replayed = false;
    let channel;
    if (command === "PRIVMSG" || command === "USERNOTICE") {
        for (const tag of tags.split(";")) {
            if (tag.startsWith("id=")) id = tag.slice(3);
            else if (tag === "petal-replay=1") replayed = true;
        }
        const target = rest.slice(end + 1);
        const stop = target.indexOf(" ");
        channel = (stop === -1 ? target : target.slice(0, stop)).replace(/^#/, "");
    }
    return { command, id, replayed, channel };
}

const anonymousNick = () => `justinfan${10_000 + Math.floor(Math.random() * 89_999)}`;

/** One read-only chat connection to a single channel, through the relay or to Twitch. */
class Listener {
    constructor(url, channel, { keepAlive }) {
        this.channel = channel;
        this.startedAt = Date.now();
        this.openedAt = 0;
        this.joinSentAt = 0;
        this.joinedAt = 0;
        this.roomStates = 0;
        this.chatLines = 0;
        this.replayedLines = 0;
        this.duplicates = 0;
        /** Arrival time of every message id. */
        this.seenAt = new Map();
        this.keepAliveSentAt = 0;
        this.keepAliveTimes = [];
        this.keepAlivesLost = 0;
        /** Close code, once the socket closed without being asked to. */
        this.closedWith = undefined;
        this.leaving = false;

        this.socket = new WebSocket(url, AS_OVERLAY);
        this.socket.addEventListener("open", () => {
            this.openedAt = Date.now();
            this.socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            this.socket.send(`NICK ${anonymousNick()}`);
            this.socket.send(`JOIN #${channel}`);
            this.joinSentAt = Date.now();
            if (keepAlive) this.timer = setInterval(() => this.#keepAlive(), KEEP_ALIVE_MS);
        });
        this.socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            const now = Date.now();
            for (const line of event.data.split("\r\n")) if (line) this.#line(line, now);
        });
        this.socket.addEventListener("close", (event) => {
            clearInterval(this.timer);
            if (!this.leaving) this.closedWith = event.code;
        });
        // A failed connection is reported by `close` as well.
        this.socket.addEventListener("error", () => {});
    }

    #keepAlive() {
        if (this.socket.readyState !== WebSocket.OPEN) return;
        if (this.keepAliveSentAt > 0) this.keepAlivesLost++;
        this.keepAliveSentAt = Date.now();
        this.socket.send(KEEP_ALIVE);
    }

    #line(line, now) {
        if (line === KEEP_ALIVE_ANSWER) {
            if (this.keepAliveSentAt > 0) this.keepAliveTimes.push(now - this.keepAliveSentAt);
            this.keepAliveSentAt = 0;
            return;
        }
        const { command, id, replayed } = inspect(line);
        switch (command) {
            case "PING":
                // Twitch asks every few minutes; the relay never does.
                this.socket.send("PONG :tmi.twitch.tv");
                return;
            case "JOIN":
                this.joinedAt ||= now;
                return;
            case "ROOMSTATE":
                this.roomStates++;
                return;
            case "PRIVMSG":
            case "USERNOTICE":
                this.chatLines++;
                if (replayed) this.replayedLines++;
                if (id === undefined) return;
                if (this.seenAt.has(id)) this.duplicates++;
                else this.seenAt.set(id, now);
                return;
        }
    }

    close() {
        this.leaving = true;
        clearInterval(this.timer);
        this.socket.close(1000);
    }
}

/**
 * Observes the candidates directly on Twitch and returns those with chat, busiest first.
 * Whether a channel is live cannot be asked without an account; whether people are talking
 * in it can be seen.
 */
async function findBusy(candidates, seconds) {
    const observed = candidates.slice(0, PROBE_CHANNELS_PER_CONNECTION * PROBE_CONNECTIONS);
    const lines = new Map(observed.map((channel) => [channel, 0]));
    const sockets = [];
    for (let at = 0; at < observed.length; at += PROBE_CHANNELS_PER_CONNECTION) {
        const channels = observed.slice(at, at + PROBE_CHANNELS_PER_CONNECTION);
        const socket = new WebSocket(TWITCH_IRC_URL);
        sockets.push(socket);
        socket.addEventListener("open", () => {
            socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            socket.send(`NICK ${anonymousNick()}`);
            socket.send(`JOIN ${channels.map((channel) => `#${channel}`).join(",")}`);
        });
        socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            for (const line of event.data.split("\r\n")) {
                if (!line) continue;
                const { command, channel } = inspect(line);
                if (command === "PING") socket.send("PONG :tmi.twitch.tv");
                else if (channel !== undefined && lines.has(channel)) {
                    lines.set(channel, lines.get(channel) + 1);
                }
            }
        });
        socket.addEventListener("error", () => {});
    }
    await sleep(seconds * 1000);
    for (const socket of sockets) socket.close(1000);
    return {
        observed: observed.length,
        busy: [...lines]
            .filter(([, count]) => count > 0)
            .sort(([, one], [, other]) => other - one)
            .map(([channel]) => channel),
    };
}

function spread(values) {
    if (values.length === 0) return "no samples";
    const sorted = [...values].sort((one, other) => one - other);
    const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
    return `median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${sorted.at(-1)} ms`;
}

function report(label, value) {
    console.log(`${label.padEnd(22)}${value}`);
}

/** The numbers of the hubs, and only numbers: what else the status holds is not repeated. */
async function reportStatus(origin) {
    let status;
    try {
        const response = await fetch(`${origin}/api/status`, {
            ...AS_OVERLAY,
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            await response.body?.cancel();
            return report("status", `not available, answered ${response.status}`);
        }
        status = await response.json();
    } catch {
        return report("status", "not available");
    }
    const shards = Array.isArray(status?.shards) ? status.shards : [];
    for (const shard of shards) {
        const numbers = Object.entries(shard)
            .filter(([name, value]) => name !== "shard" && typeof value === "number")
            .map(([name, value]) => `${name} ${value}`);
        const upstream = Array.isArray(shard.upstream?.connections)
            ? `, upstream connections ${shard.upstream.connections.length}`
            : "";
        const state = shard.available === false ? "not available" : numbers.join(", ");
        report(`hub ${shard.shard}`, `${state}${upstream}`);
    }
    if (shards.length === 0) report("status", "lists no hubs");
}

async function main() {
    const settings = await readSettings();
    report("target", settings.origin);

    let channels = settings.candidates;
    if (settings.probeSeconds > 0) {
        const { observed, busy } = await findBusy(settings.candidates, settings.probeSeconds);
        report(
            "candidates",
            `${busy.length} of ${observed} had chat within ${settings.probeSeconds} s`,
        );
        if (busy.length === 0) throw new SetupError("none of the candidates is busy right now");
        channels = busy;
    }
    channels = channels.slice(0, settings.clients);

    const overlays = Array.from({ length: settings.clients }, (_, index) => {
        const channel = channels[index % channels.length];
        const url = `${settings.socketOrigin}/api/irc?channel=${channel}`;
        return new Listener(url, channel, { keepAlive: true });
    });
    const references = channels
        .slice(0, settings.direct)
        .map((channel) => new Listener(TWITCH_IRC_URL, channel, { keepAlive: false }));
    report(
        "overlays",
        `${overlays.length} on ${channels.length} channels for ${settings.seconds} s`,
    );

    await sleep(settings.seconds * 1000);
    const stoppedAt = Date.now();
    await reportStatus(settings.origin);
    for (const listener of [...overlays, ...references]) listener.close();

    const opened = overlays.filter((overlay) => overlay.openedAt > 0);
    const joined = overlays.filter((overlay) => overlay.joinedAt > 0);
    const late = joined.filter(
        (overlay) => overlay.joinedAt - overlay.joinSentAt > JOIN_ECHO_LIMIT_MS,
    );
    const slow = opened.filter((overlay) => overlay.openedAt - overlay.startedAt > OPEN_LIMIT_MS);
    const lost = overlays.filter((overlay) => overlay.closedWith !== undefined);
    const closeCodes = new Map();
    for (const overlay of lost) {
        closeCodes.set(overlay.closedWith, (closeCodes.get(overlay.closedWith) ?? 0) + 1);
    }
    const sum = (read) => overlays.reduce((total, overlay) => total + read(overlay), 0);
    const chatLines = sum((overlay) => overlay.chatLines);
    const duplicates = sum((overlay) => overlay.duplicates);
    const keepAlives = overlays.flatMap((overlay) => overlay.keepAliveTimes);
    const keepAlivesLost = sum((overlay) => overlay.keepAlivesLost);

    report(
        "sockets opened",
        `${opened.length} of ${overlays.length}, ${spread(opened.map((overlay) => overlay.openedAt - overlay.startedAt))}`,
    );
    report(
        "JOIN echo",
        `${joined.length} of ${overlays.length}, ${spread(joined.map((overlay) => overlay.joinedAt - overlay.joinSentAt))}`,
    );
    report("JOIN echo too late", `${late.length} after more than ${JOIN_ECHO_LIMIT_MS / 1000} s`);
    report(
        "ROOMSTATE",
        `${overlays.filter((overlay) => overlay.roomStates > 0).length} of ${overlays.length} overlays`,
    );
    report(
        "chat lines",
        `${chatLines} (${(chatLines / Math.max(1, settings.seconds)).toFixed(1)} per second), ${overlays.filter((overlay) => overlay.chatLines > 0).length} overlays with chat`,
    );
    report("replayed lines", String(sum((overlay) => overlay.replayedLines)));
    report("lines received twice", String(duplicates));
    report(
        "keep-alive",
        `${keepAlives.length} answered, ${keepAlivesLost} not, ${spread(keepAlives)}`,
    );
    report(
        "sockets lost",
        lost.length === 0
            ? "0"
            : `${lost.length} (${[...closeCodes].map(([code, count]) => `${count} with code ${code}`).join(", ")})`,
    );

    let missing = 0;
    let compared = 0;
    const lags = [];
    for (const reference of references) {
        const overlay = overlays.find((candidate) => candidate.channel === reference.channel);
        if (!reference.joinedAt || !overlay?.joinedAt) continue;
        const from = Math.max(reference.joinedAt, overlay.joinedAt) + COMPARE_MARGIN_MS;
        const to = stoppedAt - COMPARE_MARGIN_MS;
        for (const [id, at] of reference.seenAt) {
            if (at < from || at > to) continue;
            compared++;
            const relayedAt = overlay.seenAt.get(id);
            if (relayedAt === undefined) missing++;
            else lags.push(relayedAt - at);
        }
    }
    if (references.length > 0) {
        report(
            "compared with Twitch",
            `${compared} lines on ${references.filter((reference) => reference.joinedAt > 0).length} channels, ${missing} missing on the relay`,
        );
        report("relay behind Twitch", spread(lags));
    }

    const healthy =
        joined.length === overlays.length &&
        late.length === 0 &&
        slow.length === 0 &&
        lost.length === 0 &&
        duplicates === 0 &&
        missing === 0;
    report("result", healthy ? "healthy" : "NOT healthy");
    return healthy ? 0 : 1;
}

try {
    process.exit(await main());
} catch (error) {
    console.error(error instanceof SetupError ? `smoke: ${error.message}` : error);
    process.exit(2);
}
