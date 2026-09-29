// End-to-end suite of the chat relay and the data gateway: runs the BUILT Worker in local
// workerd against the mock Twitch server of `mock-twitch.mjs`, and talks to it the way an
// overlay does. Everything that reaches Twitch in production reaches the mock here; only the
// data gateway asks one real provider, because its provider addresses are fixed.
//
// This is a tool, not a part of `pnpm test`: the project does not depend on Wrangler, so the
// binary comes from outside.
//
//   E2E_WRANGLER        path of the wrangler binary
//   E2E_WRANGLER_HOME   home directory for Wrangler, so it never reads the real one
//   E2E_PORT            port of the Worker; the two ports above it are used as well
//   E2E_PROJECT         project directory, already built with `pnpm build`
//
// Optional:
//   E2E_INSPECTOR_PORT  default E2E_PORT + 1
//   E2E_MOCK_PORT       default E2E_PORT + 2
//   E2E_STATE           directory for workerd's state and Wrangler's log; kept afterwards.
//                       Default: a temporary directory that is removed.
//   E2E_ONLY            scenario names, separated by commas
//   E2E_OFFLINE         1 skips the one scenario that needs a provider on the internet
//
// Prints one line per scenario and exits with 1 when one of them failed, with 2 when the suite
// could not run at all.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockTwitch } from "./mock-twitch.mjs";

/** How long the hub keeps a channel without overlays. Production waits a minute. */
const PART_GRACE_MS = 3000;
const WATCHDOG_MS = 1000;
/** The hub's own: how long a socket may take to send its JOIN. */
const JOIN_DEADLINE_MS = 30_000;
/** The limits of the start of the Worker that is filled up on purpose. */
const CAPPED_CLIENTS = 3;
const CAPPED_CHANNELS = 2;
/** The hub's default; the suite fills the buffer beyond it. */
const REPLAY_LINES = 50;
/** Twitch's limits, which the mock enforces and the hub has to respect. */
const JOINS_PER_WINDOW = 20;
const MAX_CHANNELS_PER_UPSTREAM = 50;

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 5000;
const SCENARIO_TIMEOUT_MS = 150_000;
const JOIN_TIMEOUT_MS = 15_000;
const LINE_TIMEOUT_MS = 5000;
/** Long enough for a line that must not arrive to arrive after all. */
const SETTLE_MS = 300;

const GATEWAY_ROUTE = "/api/data/bttv/3/cached/emotes/global";
/**
 * What OBS sends, and what every request and socket of the suite sends unless a scenario is
 * about another client. The relay and the gateway refuse clients that send no user agent or
 * that of a tool, the way the chat pages do.
 */
const OVERLAY_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/127.0.0.0 Safari/537.36 OBS/31.0.3";
const AS_OVERLAY = { headers: { "user-agent": OVERLAY_AGENT } };
const CACHE_HEADER = "x-petal-cache";

const MESSAGE_ID = /[;@]id=([^; ]+)/;
const REPLAY_TAG = "petal-replay=1";
/** What the scenarios put into chat: the names of the chatters and what they said. */
const CHAT_MARKS = ["synthetic", "mock1001", "mock1002", "mock2002", "mock3003", "mock7777"];

/** The suite cannot run: a setting is missing, a port is taken, the Worker does not start. */
class SetupError extends Error {}

/** An expectation that did not hold; its message is the reason printed for the scenario. */
class Failure extends Error {}

function expect(condition, reason) {
    if (!condition) throw new Failure(reason);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Asks `probe` until it answers with something, or gives up with undefined. */
async function until(probe, timeoutMs, stepMs = 50) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() >= deadline) return undefined;
        await sleep(stepMs);
    }
}

function readSettings() {
    const required = ["E2E_WRANGLER", "E2E_WRANGLER_HOME", "E2E_PORT", "E2E_PROJECT"];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) throw new SetupError(`not set: ${missing.join(", ")}`);
    const read = (name, fallback) => process.env[name] || fallback;
    const port = (name, fallback) => {
        const value = Number(read(name, fallback));
        if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
            throw new SetupError(`${name} is not a port number`);
        }
        return value;
    };
    const workerPort = port("E2E_PORT");
    return {
        wrangler: resolve(read("E2E_WRANGLER")),
        wranglerHome: resolve(read("E2E_WRANGLER_HOME")),
        project: resolve(read("E2E_PROJECT")),
        workerPort,
        inspectorPort: port("E2E_INSPECTOR_PORT", String(workerPort + 1)),
        mockPort: port("E2E_MOCK_PORT", String(workerPort + 2)),
        state: process.env.E2E_STATE ? resolve(process.env.E2E_STATE) : undefined,
        only: read("E2E_ONLY", "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        offline: process.env.E2E_OFFLINE === "1",
    };
}

function isFree(port) {
    return new Promise((done) => {
        const probe = createServer();
        probe.once("error", () => done(false));
        probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
    });
}

/**
 * Runs `wrangler dev` on the built Worker. Wrangler starts workerd as a child of its own, so
 * both live in one process group, which is what gets stopped.
 */
async function startWorker(settings, stateDirectory, variables) {
    const config = join(settings.project, ".output", "server", "wrangler.json");
    await access(config).catch(() => {
        throw new SetupError(`${config} is missing: build E2E_PROJECT first`);
    });
    for (const port of [settings.workerPort, settings.inspectorPort]) {
        if (!(await isFree(port))) throw new SetupError(`port ${port} is in use`);
    }
    const log = createWriteStream(join(stateDirectory, "wrangler.log"), { flags: "a" });
    /** Everything Wrangler and the Worker printed, which is little. */
    let output = "";
    const child = spawn(
        settings.wrangler,
        [
            "dev",
            "--config",
            config,
            "--ip",
            "127.0.0.1",
            "--port",
            String(settings.workerPort),
            "--inspector-port",
            String(settings.inspectorPort),
            "--persist-to",
            join(stateDirectory, "workerd"),
            "--show-interactive-dev-session=false",
            ...Object.entries(variables).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
        ],
        {
            cwd: settings.project,
            env: {
                ...process.env,
                HOME: settings.wranglerHome,
                WRANGLER_SEND_METRICS: "false",
                CI: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        },
    );
    let exited = false;
    let spawnError;
    const gone = new Promise((done) => {
        child.once("exit", () => {
            exited = true;
            done();
        });
        child.once("error", (error) => {
            exited = true;
            spawnError = error;
            done();
        });
    });
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
            log.write(chunk);
            output += chunk;
        });
    }

    const signal = (name) => {
        if (exited || child.pid === undefined) return;
        try {
            process.kill(-child.pid, name);
        } catch (error) {
            // The group is gone already, which is what was asked for.
            if (error.code !== "ESRCH") throw error;
        }
    };
    // The last resort when the runner itself dies on the way.
    const lastResort = () => signal("SIGKILL");
    process.on("exit", lastResort);

    const worker = {
        origin: `http://127.0.0.1:${settings.workerPort}`,
        socketOrigin: `ws://127.0.0.1:${settings.workerPort}`,
        port: settings.workerPort,
        output: () => output,
        async stop() {
            signal("SIGTERM");
            const stopped = await Promise.race([
                gone.then(() => true),
                sleep(STOP_TIMEOUT_MS).then(() => false),
            ]);
            if (!stopped) signal("SIGKILL");
            await gone;
            process.off("exit", lastResort);
            await new Promise((done) => log.end(done));
            // workerd outlives Wrangler for a moment and holds the port until it is gone.
            const released = await until(() => isFree(settings.workerPort), STOP_TIMEOUT_MS);
            if (!released) throw new SetupError(`port ${settings.workerPort} is still in use`);
        },
    };

    const ready = await until(
        async () => {
            if (exited) return "exited";
            try {
                const response = await fetch(`${worker.origin}/api/status`, {
                    ...AS_OVERLAY,
                    signal: AbortSignal.timeout(2000),
                });
                await response.body?.cancel();
                // The site would answer an unknown path with HTML; JSON is the Worker's API.
                const type = response.headers.get("content-type") ?? "";
                return type.startsWith("application/json") ? "ready" : undefined;
            } catch {
                return undefined;
            }
        },
        READY_TIMEOUT_MS,
        250,
    );
    if (ready !== "ready") {
        await worker.stop();
        const reason = spawnError
            ? `could not be started: ${spawnError.message}`
            : exited
              ? "ended before it was ready"
              : `was not ready after ${READY_TIMEOUT_MS / 1000} s`;
        throw new SetupError(`wrangler dev ${reason}\n${output.split("\n").slice(-30).join("\n")}`);
    }
    return worker;
}

/** The control interface of the mock, see `mock-twitch.mjs`. */
function mockControl(mock) {
    const call = async (path, init) => {
        const response = await fetch(`${mock.controlUrl}${path}`, init);
        const body = await response.json();
        if (!response.ok) throw new Error(`mock ${path} answered ${response.status}`);
        return body;
    };
    const post = (path, body) => call(path, { method: "POST", body });
    const control = {
        state: () => call("/ctl/state"),
        async say(channel, count = 1, user = "1001", command = "PRIVMSG") {
            const query = new URLSearchParams({ channel, n: String(count), user, command });
            return (await post(`/ctl/say?${query}`)).ids;
        },
        raw: (channel, line) => post(`/ctl/raw?channel=${channel}`, `${line}\r\n`),
        reconnect: (connection) => post(`/ctl/reconnect?connection=${connection}`),
        drop: (channel) => post(`/ctl/drop?channel=${channel}`),
        close: (channel) => post(`/ctl/close?channel=${channel}`),
        dropAll: () => post("/ctl/drop"),
        mode: (switches) => post(`/ctl/mode?${new URLSearchParams(switches)}`),
        /** What the mock received for one channel, oldest first. */
        async events(channel, type) {
            const { events } = await control.state();
            return events.filter((event) => event.channel === channel && event.type === type);
        },
        /** The open connection on which the channel is joined. */
        async carrier(channel) {
            const { connections } = await control.state();
            return connections.find((connection) => connection.channels.includes(channel));
        },
    };
    return control;
}

/** Splits the replay tag off a line; the rest must be the line as Twitch sent it. */
function withoutReplayTag(line) {
    if (!line.startsWith("@")) return { replayed: false, line };
    const end = line.indexOf(" ");
    const tags = line.slice(1, end).split(";");
    const kept = tags.filter((tag) => tag !== REPLAY_TAG);
    if (kept.length === tags.length) return { replayed: false, line };
    const head = kept.length > 0 ? `@${kept.join(";")} ` : "";
    return { replayed: true, line: `${head}${line.slice(end + 1)}` };
}

function tagsOf(line) {
    const tags = new Map();
    if (!line.startsWith("@")) return tags;
    for (const tag of line.slice(1, line.indexOf(" ")).split(";")) {
        const equals = tag.indexOf("=");
        tags.set(tag.slice(0, equals), tag.slice(equals + 1));
    }
    return tags;
}

const isRoomState = (line) => / ROOMSTATE #/.test(line);
const isJoin = (line) => / JOIN #/.test(line);

/** One overlay: a socket to `/api/irc` that logs in like `src/lib/chat/irc/client.ts`. */
class Overlay {
    constructor(socketOrigin, channel, nick) {
        this.channel = channel;
        this.nick = nick;
        /** Every line received, with its arrival time and the number of its frame. */
        this.lines = [];
        this.frames = 0;
        this.joinSentAt = 0;
        /** When this side closed the socket; 0 while it has not. */
        this.leftAt = 0;
        /** Set once the socket is closed, by either side. */
        this.closed = undefined;
        this.socket = new WebSocket(
            `${socketOrigin}/api/irc?channel=${encodeURIComponent(channel)}`,
            AS_OVERLAY,
        );
        this.opened = new Promise((done) => {
            this.socket.addEventListener("open", () => done(true));
            this.socket.addEventListener("close", () => done(false));
        });
        this.socket.addEventListener("message", (event) => {
            const at = Date.now();
            const frame = this.frames++;
            for (const line of String(event.data).split("\r\n")) {
                if (line) this.lines.push({ at, frame, line });
            }
        });
        this.socket.addEventListener("close", (event) => {
            this.closed = { code: event.code, at: Date.now() };
        });
        // A failed connection is reported by `close` as well.
        this.socket.addEventListener("error", () => {});
    }

    async login(target = this.channel) {
        expect(await this.opened, `the relay did not accept a socket for #${this.channel}`);
        this.socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.socket.send(`NICK ${this.nick}`);
        this.socket.send(`JOIN #${target}`);
        this.joinSentAt = Date.now();
    }

    /** The first line that matches, or undefined when it did not arrive in time. */
    waitFor(matches, timeoutMs = LINE_TIMEOUT_MS) {
        return until(
            () => this.lines.find((entry) => matches(entry.line)) ?? (this.closed && "closed"),
            timeoutMs,
            5,
        ).then((found) => (found === "closed" ? undefined : found));
    }

    waitForId(id, timeoutMs) {
        return this.waitFor((line) => MESSAGE_ID.exec(line)?.[1] === id, timeoutMs);
    }

    echoes() {
        return this.lines.filter((entry) => isJoin(entry.line));
    }

    /** Logs in and waits for the JOIN echo, which is what makes an overlay show chat. */
    async join(timeoutMs = JOIN_TIMEOUT_MS) {
        await this.login();
        const echo = await this.waitFor(isJoin, timeoutMs);
        expect(echo, `no JOIN echo for #${this.channel} within ${timeoutMs / 1000} s`);
        return echo;
    }

    /** Ids of the chat lines received, in order of arrival. */
    ids({ replayed } = {}) {
        const ids = [];
        for (const { line } of this.lines) {
            const id = MESSAGE_ID.exec(line)?.[1];
            if (id === undefined) continue;
            if (replayed === undefined || withoutReplayTag(line).replayed === replayed) {
                ids.push(id);
            }
        }
        return ids;
    }

    close() {
        this.leftAt ||= Date.now();
        this.socket.close(1000);
    }
}

/** A request with a raw path and any header, neither of which `fetch` allows. */
function rawRequest(worker, path, { method = "GET", headers = {}, body } = {}) {
    return new Promise((done, fail) => {
        const attempt = httpRequest({
            host: "127.0.0.1",
            port: worker.port,
            path,
            method,
            headers: { ...AS_OVERLAY.headers, ...headers },
        });
        attempt.on("response", (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                done({
                    status: response.statusCode,
                    headers: response.headers,
                    text: Buffer.concat(chunks).toString("utf8"),
                });
            });
            response.on("error", fail);
        });
        attempt.on("upgrade", (response, socket) => {
            socket.destroy();
            done({ status: response.statusCode, headers: response.headers, text: "" });
        });
        attempt.on("error", fail);
        attempt.setTimeout(10_000, () => attempt.destroy(new Error(`${path} timed out`)));
        attempt.end(body);
    });
}

function upgradeRequest(worker, path, headers = {}) {
    return rawRequest(worker, path, {
        headers: {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": randomBytes(16).toString("base64"),
            ...headers,
        },
    });
}

/** A refusal of the API: JSON that names an error, and never stored by anybody. */
function expectRefusal(response, status, what) {
    expect(response.status === status, `${what}: answered ${response.status} instead of ${status}`);
    const type = String(response.headers["content-type"] ?? "");
    expect(type.startsWith("application/json"), `${what}: the refusal is ${type}, not JSON`);
    expect(
        response.headers["cache-control"] === "no-store",
        `${what}: the refusal may be cached (${response.headers["cache-control"]})`,
    );
    let body;
    try {
        body = JSON.parse(response.text);
    } catch {
        throw new Failure(`${what}: the refusal is not valid JSON`);
    }
    expect(typeof body?.error === "string", `${what}: the refusal names no error`);
}

function sameOrder(actual, expected) {
    return actual.length === expected.length && actual.every((id, at) => id === expected[at]);
}

/** Twitch ends the connection that carries the channel; `lose` says in which way. */
async function upstreamLoss(t, channel, lose) {
    const overlay = t.overlay(channel);
    await overlay.join();
    const [before] = await t.mock.say(channel);
    expect(await overlay.waitForId(before), "the overlay missed the line before the loss");
    const old = await t.mock.carrier(channel);

    const lostAt = Date.now();
    await lose(channel);
    const carrier = await until(
        async () => {
            const found = await t.mock.carrier(channel);
            return found && found.id !== old.id ? found : undefined;
        },
        30_000,
        100,
    );
    expect(carrier, "the channel was not joined on a new connection within 30 s");
    const recovered = Date.now() - lostAt;
    const [after] = await t.mock.say(channel);
    expect(await overlay.waitForId(after), "chat did not continue after the loss");
    expect(!overlay.closed, "the overlay socket was closed");
    expect(overlay.echoes().length === 1, "the overlay received a second JOIN echo");
    return `joined again after ${recovered} ms`;
}

/**
 * The scenarios, in the order in which they run. Each gets `t`: the Worker, the mock's control
 * interface and `overlay(channel)`, which opens an overlay that is closed when the scenario
 * ends. Every scenario uses channels of its own, so none depends on what ran before it.
 * A scenario fails by throwing, and may return a remark for its line in the report.
 */
const scenarios = {
    async handshake(t) {
        const channel = "e2e_handshake";
        const overlay = t.overlay(channel);
        const echo = await overlay.join();
        const { nick } = overlay;
        expect(
            echo.line === `:${nick}!${nick}@${nick}.tmi.twitch.tv JOIN #${channel}`,
            "the JOIN echo does not carry the nick and the channel of the overlay",
        );
        const lines = overlay.lines.map((entry) => entry.line);
        const order = [
            lines.indexOf(":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands"),
            ...["001", "002", "003", "004", "375", "372", "376"].map((numeric) =>
                lines.findIndex((line) => line.startsWith(`:tmi.twitch.tv ${numeric} ${nick} `)),
            ),
            lines.indexOf(echo.line),
        ];
        expect(
            order.every((at, index) => at !== -1 && (index === 0 || at > order[index - 1])),
            "CAP ACK, the welcome numerics and the JOIN echo are incomplete or out of order",
        );
        const joins = await t.mock.events(channel, "join");
        expect(joins.length === 1, `Twitch received ${joins.length} JOINs instead of 1`);
        expect(joins[0].at <= echo.at, "the JOIN echo arrived before Twitch saw the JOIN");
        const carrier = await t.mock.carrier(channel);
        expect(/^justinfan\d+$/.test(carrier?.nick ?? ""), "the upstream login is not anonymous");
        expect(
            carrier.capabilities === "twitch.tv/tags twitch.tv/commands",
            "the upstream connection did not request tags and commands",
        );
        expect(await overlay.waitFor(isRoomState), "the ROOMSTATE was not forwarded");
        return `JOIN echo ${echo.at - overlay.joinSentAt} ms after JOIN`;
    },

    async "fan-out"(t) {
        const channel = "e2e_fanout";
        const overlays = [t.overlay(channel), t.overlay(channel), t.overlay(channel)];
        await Promise.all(overlays.map((overlay) => overlay.join()));
        const ids = await t.mock.say(channel, 5);
        for (const [index, overlay] of overlays.entries()) {
            expect(await overlay.waitForId(ids.at(-1)), `overlay ${index + 1} missed the lines`);
            expect(
                sameOrder(overlay.ids({ replayed: false }), ids),
                `overlay ${index + 1} did not receive the 5 lines once and in order`,
            );
            expect(overlay.ids({ replayed: true }).length === 0, "a live line is tagged as replay");
        }
        const joins = await t.mock.events(channel, "join");
        expect(joins.length === 1, `3 overlays caused ${joins.length} upstream JOINs`);
    },

    async isolation(t) {
        const one = t.overlay("e2e_isolated_a");
        const other = t.overlay("e2e_isolated_b");
        await Promise.all([one.join(), other.join()]);
        const forOne = await t.mock.say(one.channel, 3);
        const forOther = await t.mock.say(other.channel, 2);
        expect(await one.waitForId(forOne.at(-1)), "the first channel missed its lines");
        expect(await other.waitForId(forOther.at(-1)), "the second channel missed its lines");
        await sleep(SETTLE_MS);
        expect(sameOrder(one.ids(), forOne), "the first overlay saw lines that are not its own");
        expect(sameOrder(other.ids(), forOther), "the second overlay saw lines of the first");
        for (const [overlay, foreign] of [
            [one, other.channel],
            [other, one.channel],
        ]) {
            expect(
                overlay.lines.every((entry) => !entry.line.includes(`#${foreign}`)),
                "an overlay received a line that names the other channel",
            );
        }
    },

    async forwarding(t) {
        const channel = "e2e_forwarding";
        const overlay = t.overlay(channel);
        await overlay.join();
        expect(await overlay.waitFor(isRoomState), "the ROOMSTATE was not forwarded");
        const before = overlay.lines.length;
        const carrier = await t.mock.carrier(channel);

        const chat = `badge-info=;badges=;color=;emotes=;room-id=1;tmi-sent-ts=${Date.now()};user-id=3003`;
        const sender = ":mock3003!mock3003@mock3003.tmi.twitch.tv";
        const deleted = randomUUID();
        const forwarded = [
            `@${chat};display-name=Mock3003;id=${randomUUID()} ${sender} PRIVMSG #${channel} :synthetic line`,
            `@${chat};id=${randomUUID()};login=mock3003;msg-id=resub :tmi.twitch.tv USERNOTICE #${channel} :synthetic notice`,
            `@msg-id=slow_on :tmi.twitch.tv NOTICE #${channel} :synthetic notice of the room`,
            `@room-id=1;slow=10 :tmi.twitch.tv ROOMSTATE #${channel}`,
            `@login=mock3003;room-id=1;target-msg-id=${deleted};tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARMSG #${channel} :synthetic line`,
            `@room-id=1;target-user-id=3003;tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARCHAT #${channel} :mock3003`,
        ];
        // What Twitch also sends on the connection and no overlay asked for.
        const kept = [
            "PING :tmi.twitch.tv",
            `@badge-info=;badges=;color=;display-name=x;emote-sets=0;mod=0 :tmi.twitch.tv USERSTATE #${channel}`,
            `${sender} JOIN #${channel}`,
            `${sender} PART #${channel}`,
            `:tmi.twitch.tv 421 ${carrier.nick} WHO :Unknown command`,
            `@${chat};id=${randomUUID()} ${sender} PRIVMSG #e2e_forwarding_other :synthetic line`,
        ];
        // All in one frame, which is how Twitch sends lines that come at the same time.
        const frame = forwarded.flatMap((line, index) => [kept[index], line]);
        await t.mock.raw(channel, frame.join("\r\n"));
        const [last] = await t.mock.say(channel);
        expect(await overlay.waitForId(last), "the overlay missed the lines");

        const got = overlay.lines.slice(before, -1).map((entry) => entry.line);
        const lost = forwarded.filter((line) => !got.includes(line)).length;
        const extra = got.filter((line) => !forwarded.includes(line)).length;
        expect(
            lost === 0,
            `${lost} of ${forwarded.length} kinds of lines were not forwarded unchanged`,
        );
        expect(extra === 0, `${extra} lines reached the overlay that are not meant for it`);
        expect(sameOrder(got, forwarded), "the lines arrived out of order");
        const answered = await until(
            async () => (await t.mock.carrier(channel))?.pongs === carrier.pongs + 1,
            LINE_TIMEOUT_MS,
        );
        expect(answered, "the PING of Twitch was not answered");
        return `${forwarded.length} kinds of lines forwarded, ${kept.length} kept back`;
    },

    async "room-state"(t) {
        const channel = "e2e_roomstate";
        const early = t.overlay(channel);
        await early.join();
        const full = await early.waitFor(isRoomState);
        expect(full, "the ROOMSTATE was not forwarded");
        // Twitch sends the whole state after the JOIN and only what changed afterwards.
        const change = `@room-id=1;slow=30 :tmi.twitch.tv ROOMSTATE #${channel}`;
        await t.mock.raw(channel, change);
        expect(
            await early.waitFor((line) => line === change),
            "the change of the room state was not forwarded unchanged",
        );

        const late = t.overlay(channel);
        const echo = await late.join();
        await sleep(SETTLE_MS);
        const states = late.lines.filter((entry) => isRoomState(entry.line));
        expect(states.length === 1, `the late overlay got ${states.length} ROOMSTATE lines`);
        expect(
            states[0].frame === echo.frame,
            "the ROOMSTATE is not in the frame of the JOIN echo",
        );
        const tags = tagsOf(states[0].line);
        expect(tags.get("slow") === "30", "the late overlay got the room state before the change");
        for (const [name, value] of tagsOf(full.line)) {
            if (name === "slow") continue;
            expect(tags.get(name) === value, `the room state of the late overlay lost ${name}`);
        }
        return `${tags.size} tags`;
    },

    async replay(t) {
        const channel = "e2e_replay";
        const early = t.overlay(channel);
        await early.join();
        expect(await early.waitFor(isRoomState), "the first overlay never got the ROOMSTATE");
        const ids = [
            ...(await t.mock.say(channel, 40)),
            ...(await t.mock.say(channel, 5, "1002", "USERNOTICE")),
            ...(await t.mock.say(channel, 15)),
        ];
        expect(await early.waitForId(ids.at(-1)), "the first overlay missed the lines");
        const live = new Map(early.lines.map((entry) => [MESSAGE_ID.exec(entry.line)?.[1], entry]));

        const late = t.overlay(channel);
        const echo = await late.join();
        await sleep(SETTLE_MS);
        const greeting = late.lines.filter((entry) => entry.frame === echo.frame);
        expect(greeting[0] === echo, "the JOIN echo is not the first line of its frame");
        expect(
            greeting[1] && isRoomState(greeting[1].line),
            "the ROOMSTATE does not follow the JOIN echo in the same frame",
        );
        const replayed = greeting.slice(2);
        const expected = ids.slice(-REPLAY_LINES);
        expect(
            replayed.length === expected.length,
            `${replayed.length} lines were replayed in the frame of the JOIN echo instead of ${expected.length}`,
        );
        for (const [index, entry] of replayed.entries()) {
            const original = withoutReplayTag(entry.line);
            expect(original.replayed, `replayed line ${index + 1} does not carry the replay tag`);
            expect(
                original.line === live.get(expected[index])?.line,
                `replayed line ${index + 1} is not line ${index + 1} of the last ${expected.length}, unchanged`,
            );
        }
        expect(
            late.ids().length === replayed.length,
            "the late overlay received chat lines outside of the frame of the JOIN echo",
        );
        expect(
            early.ids({ replayed: true }).length === 0,
            "the overlay that was there received a replay",
        );
        return `${replayed.length} of ${ids.length} lines replayed`;
    },

    async moderation(t) {
        const channel = "e2e_moderation";
        const witness = t.overlay(channel);
        await witness.join();
        const kept = await t.mock.say(channel, 3, "1001");
        const banned = await t.mock.say(channel, 2, "2002");
        expect(await witness.waitForId(banned.at(-1)), "the overlay missed the lines");

        const deleted = kept[1];
        const clearMessage = `@login=mock1001;room-id=1;target-msg-id=${deleted};tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARMSG #${channel} :synthetic line`;
        const clearUser = `@ban-duration=600;room-id=1;target-user-id=2002;tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARCHAT #${channel} :mock2002`;
        await t.mock.raw(channel, clearMessage);
        await t.mock.raw(channel, clearUser);
        expect(
            await witness.waitFor((line) => line === clearMessage),
            "CLEARMSG was not forwarded unchanged",
        );
        expect(
            await witness.waitFor((line) => line === clearUser),
            "CLEARCHAT was not forwarded unchanged",
        );

        const afterPurge = t.overlay(channel);
        await afterPurge.join();
        await sleep(SETTLE_MS);
        const remaining = kept.filter((id) => id !== deleted);
        const replayed = afterPurge.ids({ replayed: true });
        expect(
            sameOrder(replayed, remaining),
            `after CLEARMSG and CLEARCHAT the replay has ${replayed.length} lines and not the ${remaining.length} that are left`,
        );

        const clearAll = `@room-id=1;tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARCHAT #${channel}`;
        await t.mock.raw(channel, clearAll);
        expect(
            await witness.waitFor((line) => line === clearAll),
            "the CLEARCHAT of the whole chat was not forwarded",
        );
        const afterClear = t.overlay(channel);
        await afterClear.join();
        await sleep(SETTLE_MS);
        expect(
            afterClear.ids().length === 0,
            `${afterClear.ids().length} lines were replayed after the chat was cleared`,
        );
    },

    async "keep-alive"(t) {
        const overlay = t.overlay("e2e_keepalive");
        await overlay.join();
        const sentAt = Date.now();
        overlay.socket.send("PING :petal");
        const pong = await overlay.waitFor(
            (line) => line === ":tmi.twitch.tv PONG tmi.twitch.tv :petal",
        );
        expect(pong, "the keep-alive was not answered");
        expect(!overlay.closed, "the socket closed after the keep-alive");
        return `answered after ${pong.at - sentAt} ms`;
    },

    async "clean-close"(t) {
        const overlay = t.overlay("e2e_close");
        await overlay.join();
        overlay.close();
        await until(() => overlay.closed, LINE_TIMEOUT_MS, 10);
        expect(
            overlay.closed,
            `the close of the overlay was not answered within ${LINE_TIMEOUT_MS / 1000} s`,
        );
        expect(overlay.closed.code === 1000, `closed with ${overlay.closed.code} instead of 1000`);
        return `closed after ${overlay.closed.at - overlay.leftAt} ms`;
    },

    async "never-joined"(t) {
        const overlay = t.overlay("e2e_never_joined");
        expect(await overlay.opened, "the relay did not accept the socket");
        const openedAt = Date.now();
        // Local workerd delivers a close that the alarm asked for some ten seconds later.
        await until(() => overlay.closed, JOIN_DEADLINE_MS + 25_000, 100);
        expect(overlay.closed, "a socket that never sent a JOIN is still open");
        const after = overlay.closed.at - openedAt;
        expect(overlay.closed.code === 1008, `closed with ${overlay.closed.code} instead of 1008`);
        expect(after >= JOIN_DEADLINE_MS - 1000, `closed after ${after} ms already`);
        return `closed after ${after} ms`;
    },

    async "channel-mismatch"(t) {
        const overlay = t.overlay("e2e_mismatch_a");
        await overlay.login("e2e_mismatch_b");
        await until(() => overlay.closed, LINE_TIMEOUT_MS, 10);
        expect(overlay.closed, "the socket stayed open after a JOIN for another channel");
        expect(overlay.closed.code === 1008, `closed with ${overlay.closed.code} instead of 1008`);
        expect(overlay.echoes().length === 0, "the JOIN for another channel was echoed");
        for (const channel of ["e2e_mismatch_a", "e2e_mismatch_b"]) {
            const joins = await t.mock.events(channel, "join");
            expect(joins.length === 0, "the mismatched JOIN reached Twitch");
        }
    },

    async "invalid-channel"(t) {
        const paths = [
            "/api/irc?channel=bad%20name",
            "/api/irc?channel=bad-name",
            "/api/irc?channel=a%23b",
            `/api/irc?channel=${"a".repeat(26)}`,
            "/api/irc?channel=",
            "/api/irc",
        ];
        for (const [index, path] of paths.entries()) {
            expectRefusal(
                await upgradeRequest(t.worker, path),
                400,
                `invalid channel ${index + 1}`,
            );
        }
        return `${paths.length} names refused`;
    },

    async "not-an-upgrade"(t) {
        const response = await rawRequest(t.worker, "/api/irc?channel=e2e_plain");
        expectRefusal(response, 426, "plain GET");
    },

    async "foreign-origin"(t) {
        const path = "/api/irc?channel=e2e_origin";
        const foreign = await upgradeRequest(t.worker, path, { origin: "https://example.com" });
        expectRefusal(foreign, 403, "socket of another website");
        const own = await upgradeRequest(t.worker, path, { origin: t.worker.origin });
        expect(own.status === 101, `the site's own origin was answered with ${own.status}`);
    },

    async "automated-client"(t) {
        const channel = "e2e_automated";
        const agents = ["", "curl/8.7.1", "Mozilla/5.0 (compatible; GPTBot/1.2)"];
        for (const agent of agents) {
            const as = { "user-agent": agent };
            const what = agent ? `user agent ${agent}` : "no user agent";
            const socket = await upgradeRequest(t.worker, `/api/irc?channel=${channel}`, as);
            expectRefusal(socket, 403, `socket, ${what}`);
            const data = await rawRequest(t.worker, GATEWAY_ROUTE, { headers: as });
            expectRefusal(data, 403, `provider data, ${what}`);
            expect(data.headers[CACHE_HEADER], `${what}: the ${CACHE_HEADER} header is missing`);
            // A monitor is a script, and the status holds nothing a crawler could take.
            const status = await rawRequest(t.worker, "/api/status", { headers: as });
            expect(status.status === 200, `status, ${what}: answered ${status.status}`);
        }
        const joins = await t.mock.events(channel, "join");
        expect(joins.length === 0, "a refused client made the hub join its channel");
        return `${agents.length} clients refused`;
    },

    async "part-after-grace"(t) {
        const channel = "e2e_part";
        const overlay = t.overlay(channel);
        await overlay.join();
        overlay.close();
        const part = await until(
            async () => (await t.mock.events(channel, "part"))[0],
            PART_GRACE_MS + 10_000,
            100,
        );
        expect(part, "Twitch never received a PART after the last overlay left");
        const waited = part.at - overlay.leftAt;
        // The hub notices that the overlay left a moment later, never before.
        expect(
            waited >= PART_GRACE_MS - 100,
            `PART after ${waited} ms, before the grace period of ${PART_GRACE_MS} ms was over`,
        );
        return `PART ${waited} ms after the overlay left`;
    },

    async "rejoin-in-grace"(t) {
        const channel = "e2e_rejoin";
        const first = t.overlay(channel);
        await first.join();
        const ids = await t.mock.say(channel, 2);
        expect(await first.waitForId(ids.at(-1)), "the overlay missed the lines");
        first.close();

        // An OBS scene change: gone and back before the grace period is over.
        await sleep(PART_GRACE_MS / 3);
        const second = t.overlay(channel);
        const echo = await second.join();
        await sleep(SETTLE_MS);
        expect(
            sameOrder(second.ids({ replayed: true }), ids),
            "the returning overlay did not get the replay",
        );
        await sleep(Math.max(0, first.leftAt + PART_GRACE_MS + 2500 - Date.now()));
        const parts = await t.mock.events(channel, "part");
        const joins = await t.mock.events(channel, "join");
        expect(parts.length === 0, "the channel was parted although an overlay came back");
        expect(joins.length === 1, `Twitch received ${joins.length} JOINs instead of 1`);
        const [after] = await t.mock.say(channel);
        expect(await second.waitForId(after), "chat stopped for the returning overlay");
        return `JOIN echo ${echo.at - second.joinSentAt} ms after JOIN, without an upstream JOIN`;
    },

    "upstream-drop": (t) => upstreamLoss(t, "e2e_drop", (channel) => t.mock.drop(channel)),

    "upstream-close": (t) => upstreamLoss(t, "e2e_close_up", (channel) => t.mock.close(channel)),

    async reconnect(t) {
        const channels = Array.from({ length: 5 }, (_, index) => `e2e_reconnect${index}`);
        const overlays = channels.map((channel) => t.overlay(channel));
        await Promise.all(overlays.map((overlay) => overlay.join()));
        const before = await t.mock.state();
        const old = before.connections.filter((connection) =>
            channels.some((channel) => connection.channels.includes(channel)),
        );

        const sent = new Map(channels.map((channel) => [channel, []]));
        let running = true;
        const traffic = (async () => {
            while (running) {
                for (const channel of channels) {
                    sent.get(channel).push(...(await t.mock.say(channel)));
                }
                await sleep(20);
            }
        })();
        try {
            // Twitch confirms a PART late, so both connections deliver for a while.
            await t.mock.mode({ partDelayMs: "400" });
            await sleep(500);
            const announcedAt = Date.now();
            for (const connection of old) await t.mock.reconnect(connection.id);
            const moved = await until(
                async () => {
                    const { connections } = await t.mock.state();
                    return old.every((gone) => connections.every((open) => open.id !== gone.id));
                },
                60_000,
                100,
            );
            expect(moved, "the connection that was told to RECONNECT is still open after 60 s");
            const took = Date.now() - announcedAt;
            await sleep(500);
            running = false;
            await traffic;

            let total = 0;
            for (const overlay of overlays) {
                const wanted = sent.get(overlay.channel);
                total += wanted.length;
                expect(await overlay.waitForId(wanted.at(-1)), "an overlay missed the last line");
                const got = overlay.ids();
                const lost = wanted.filter((id) => !got.includes(id)).length;
                const twice = got.length - new Set(got).size;
                expect(lost === 0, `${lost} of ${wanted.length} lines were lost in the handover`);
                expect(twice === 0, `${twice} lines were delivered twice in the handover`);
                expect(sameOrder(got, wanted), "the lines arrived out of order");
                expect(!overlay.closed, "an overlay socket was closed");
                expect(overlay.echoes().length === 1, "an overlay received a second JOIN echo");
            }
            return `${total} lines on ${channels.length} channels, handover took ${took} ms`;
        } finally {
            running = false;
            await traffic.catch(() => {});
            await t.mock.mode({ partDelayMs: "0" });
        }
    },

    async "unanswered-join"(t) {
        // Twitch says nothing about a channel that does not exist, and neither does the mock.
        const ghost = t.overlay("nx_e2e_ghost");
        const neighbour = t.overlay("e2e_beside_ghost");
        await ghost.login();
        await neighbour.join();
        const waitMs = 12_000;
        await sleep(waitMs);
        expect(ghost.echoes().length === 0, "a JOIN that Twitch never confirmed was echoed");
        const joins = await t.mock.events(ghost.channel, "join");
        expect(
            joins.length >= 1 && joins.length <= 3,
            `${joins.length} JOINs within ${waitMs / 1000} s for a channel that does not answer`,
        );
        const [id] = await t.mock.say(neighbour.channel);
        expect(await neighbour.waitForId(id), "the channel next to it lost its chat");
        return `${joins.length} JOIN within ${waitMs / 1000} s`;
    },

    async "upstream-refused"(t) {
        const channel = "e2e_refused";
        await t.mock.mode({ refuse: "1" });
        try {
            // With no connection left, the hub has to open one, which Twitch refuses.
            await t.mock.dropAll();
            const before = (await t.mock.state()).counts.refused;
            const waiting = t.overlay(channel);
            await waiting.login();
            const waitMs = 4000;
            await sleep(waitMs);
            const refused = (await t.mock.state()).counts.refused - before;
            expect(refused >= 1, "the hub never tried to connect");
            expect(refused <= 8, `${refused} attempts to connect within ${waitMs / 1000} s`);
            expect(waiting.echoes().length === 0, "a JOIN was echoed while Twitch was away");

            const backAt = Date.now();
            await t.mock.mode({ refuse: "0" });
            const returning = t.overlay(channel);
            const echo = await returning.join(45_000);
            if (!waiting.closed) {
                expect(await waiting.waitFor(isJoin), "the overlay that waited got no JOIN echo");
            }
            const [id] = await t.mock.say(channel);
            expect(await returning.waitForId(id), "chat did not start once Twitch was back");
            return `${refused} attempts refused, joined ${echo.at - backAt} ms after Twitch was back`;
        } finally {
            await t.mock.mode({ refuse: "0" });
        }
    },

    async "upstream-silent"(t) {
        const channel = "e2e_silent";
        const overlay = t.overlay(channel);
        await overlay.join();
        const old = await t.mock.carrier(channel);
        const silentAt = Date.now();
        // The connection stays open and says nothing any more, not even PONG.
        await t.mock.mode({ silent: "1" });
        try {
            const given = await until(
                async () => (await t.mock.state()).closed.some((gone) => gone.id === old.id),
                75_000,
                250,
            );
            expect(given, "a connection that fell silent was still in use after 75 s");
            const noticed = Date.now() - silentAt;
            await t.mock.mode({ silent: "0" });
            const carrier = await until(
                async () => {
                    const found = await t.mock.carrier(channel);
                    return found && found.id !== old.id ? found : undefined;
                },
                45_000,
                250,
            );
            expect(carrier, "the channel was not joined again within 45 s");
            const [id] = await t.mock.say(channel);
            expect(await overlay.waitForId(id), "chat did not continue");
            expect(!overlay.closed, "the overlay socket was closed");
            expect(overlay.echoes().length === 1, "the overlay received a second JOIN echo");
            return `given up after ${noticed} ms`;
        } finally {
            await t.mock.mode({ silent: "0" });
        }
    },

    async "join-burst"(t) {
        const channels = Array.from({ length: 60 }, (_, index) => `e2e_burst${index}`);
        const overlays = channels.map((channel) => t.overlay(channel));
        const startedAt = Date.now();
        const echoes = await Promise.all(overlays.map((overlay) => overlay.join(90_000)));
        const last = Math.max(...echoes.map((echo) => echo.at)) - startedAt;

        const { connections, closed } = await t.mock.state();
        for (const connection of [...connections, ...closed]) {
            expect(
                connection.droppedJoins === 0,
                `Twitch dropped ${connection.droppedJoins} JOINs of one connection`,
            );
            expect(
                connection.maxJoinsPerWindow <= JOINS_PER_WINDOW,
                `one connection sent ${connection.maxJoinsPerWindow} JOINs within 10 s`,
            );
            expect(
                connection.channels.length <= MAX_CHANNELS_PER_UPSTREAM,
                `one connection holds ${connection.channels.length} channels`,
            );
        }
        const carriers = connections.filter((connection) =>
            connection.channels.some((channel) => channels.includes(channel)),
        );
        for (const channel of channels) {
            const joinedOn = carriers.filter((carrier) => carrier.channels.includes(channel));
            expect(joinedOn.length === 1, `a channel is joined on ${joinedOn.length} connections`);
        }
        expect(
            carriers.length >= 2,
            `60 channels are on ${carriers.length} upstream connection, above its limit of ${MAX_CHANNELS_PER_UPSTREAM}`,
        );
        const busiest = Math.max(...carriers.map((carrier) => carrier.maxJoinsPerWindow));
        return `${carriers.length} upstream connections, at most ${busiest} JOINs per 10 s, last JOIN echo after ${last} ms`;
    },

    async status(t) {
        const overlays = [
            t.overlay("e2e_status_a"),
            t.overlay("e2e_status_a"),
            t.overlay("e2e_status_b"),
        ];
        await Promise.all(overlays.map((overlay) => overlay.join()));
        const ids = await t.mock.say("e2e_status_a", 3, "7777");
        expect(await overlays[0].waitForId(ids.at(-1)), "the overlay missed the lines");

        // The overlays of the scenario before may still be leaving.
        let text;
        const status = await until(
            async () => {
                const response = await fetch(`${t.worker.origin}/api/status`, AS_OVERLAY);
                expect(response.status === 200, `answered ${response.status}`);
                const type = response.headers.get("content-type") ?? "";
                expect(type.startsWith("application/json"), `the status is ${type}, not JSON`);
                expect(
                    response.headers.get("cache-control") === "no-store",
                    "the status may be cached",
                );
                text = await response.text();
                const body = JSON.parse(text);
                return body.shards?.[0]?.clients === overlays.length ? body : undefined;
            },
            3000,
            500,
        );
        expect(status, `the status does not count ${overlays.length} overlays`);
        expect(status.relayEnabled === true, "the relay is not reported as enabled");
        expect(
            Array.isArray(status.shards) && status.shards.length === 1,
            "the status does not list the one shard of this run",
        );
        const [shard] = status.shards;
        expect(shard.shard === 0 && shard.available === true, "the hub is not available");
        expect(
            Number.isInteger(shard.channels) && shard.channels >= 2,
            `${shard.channels} channels counted with overlays on 2`,
        );

        // Counts only: nothing that names a channel, an overlay, a chatter or what was said.
        const lowered = text.toLowerCase();
        const secrets = [...t.channels, "justinfan", ...CHAT_MARKS, ...ids];
        const leaked = secrets.filter((secret) => lowered.includes(secret.toLowerCase()));
        expect(leaked.length === 0, `the status names ${leaked.length} things it must not name`);

        const post = await rawRequest(t.worker, "/api/status", { method: "POST" });
        expectRefusal(post, 405, "POST");
        return `${shard.clients} overlays on ${shard.channels} channels, ${text.length} bytes`;
    },

    async "unknown-api-route"(t) {
        for (const path of ["/api/unknown", "/api/irc/extra", "/api/"]) {
            expectRefusal(await rawRequest(t.worker, path), 404, path);
        }
    },

    async "gateway-refusals"(t) {
        const post = { method: "POST", headers: { "content-type": "application/json" } };
        const cases = [
            ["traversal", "/api/data/7tv/v3/emote-sets/../../../bttv/../etc/passwd", 400],
            ["encoded traversal", "/api/data/7tv/v3/emote-sets/%2e%2e%2f%2e%2e%2fusers", 400],
            ["encoded slash", "/api/data/bttv/3/cached/users/twitch/1%2F..%2F..%2Fglobal", 400],
            ["unknown provider", "/api/data/example/v1/emotes", 400],
            ["path outside the allowlist", "/api/data/7tv/v3/users/1", 400],
            ["full address as path", "/api/data/https://example.com/", 400],
            ["extra query parameter", `${GATEWAY_ROUTE}?callback=x`, 400],
            ["missing query parameter", "/api/data/ivr/v2/twitch/badges/channel", 400],
            ["POST to a GET route", GATEWAY_ROUTE, 405, post],
            ["GET to the POST route", "/api/data/7tv/v4/gql", 405],
            ["DELETE", GATEWAY_ROUTE, 405, { method: "DELETE" }],
            [
                "POST of another query",
                "/api/data/7tv/v4/gql",
                400,
                { ...post, body: JSON.stringify({ query: "{ users { id } }" }) },
            ],
        ];
        for (const [what, path, status, options] of cases) {
            const response = await rawRequest(t.worker, path, options);
            expectRefusal(response, status, what);
            expect(
                response.headers[CACHE_HEADER],
                `${what}: the ${CACHE_HEADER} header is missing`,
            );
        }
        return `${cases.length} requests refused`;
    },

    async "gateway-cache"(t) {
        if (t.offline) return t.skip("E2E_OFFLINE is set");
        const ask = async () => {
            const startedAt = Date.now();
            const response = await fetch(`${t.worker.origin}${GATEWAY_ROUTE}`, AS_OVERLAY);
            const text = await response.text();
            return { response, text, took: Date.now() - startedAt };
        };
        const first = await ask();
        expect(
            first.response.status === 200,
            `the provider route answered ${first.response.status} (${first.response.headers.get(CACHE_HEADER)})`,
        );
        const cache = first.response.headers.get(CACHE_HEADER) ?? "";
        expect(
            /^(MISS|HIT|EXPIRED|UPDATING)\b/.test(cache),
            `unexpected ${CACHE_HEADER}: ${cache}`,
        );
        const type = first.response.headers.get("content-type") ?? "";
        expect(type.startsWith("application/json"), `the answer is ${type}, not JSON`);
        expect(Array.isArray(JSON.parse(first.text)), "the answer is not the provider's list");

        const second = await ask();
        expect(second.response.status === 200, `the second request got ${second.response.status}`);
        const again = second.response.headers.get(CACHE_HEADER) ?? "";
        expect(/^HIT\b/.test(again), `the second request was ${again}, not a cache hit`);
        expect(second.text === first.text, "the cached answer differs from the first one");
        return `${cache} in ${first.took} ms, then ${again} in ${second.took} ms`;
    },

    async "idle-release"(t) {
        // Everything the scenarios before opened is closed by now.
        const released = await until(
            async () => {
                const { connections } = await t.mock.state();
                return connections.length === 0;
            },
            PART_GRACE_MS + 20_000,
            250,
        );
        const { connections, counts } = await t.mock.state();
        const joined = connections.reduce((sum, connection) => sum + connection.channels.length, 0);
        expect(
            released,
            `${connections.length} upstream connections with ${joined} channels are still open without any overlay`,
        );
        expect(
            counts.droppedJoins === 0,
            `Twitch dropped ${counts.droppedJoins} JOINs during the run`,
        );
        return `${counts.opened} upstream connections were used and all are closed`;
    },

    async "quiet-log"(t) {
        // In local workerd whatever the Worker logs is printed by Wrangler.
        const printed = t.worker.output().toLowerCase();
        const chat = CHAT_MARKS.filter((mark) => printed.includes(mark)).length;
        const names = ["justinfan", ...t.channels].filter((name) => printed.includes(name)).length;
        expect(chat === 0, `the log holds ${chat} of the names and words that were in chat`);
        expect(names === 0, `the log holds ${names} names of channels or overlays`);
        return `${printed.split("\n").length} lines of log`;
    },
};

/** Run against a start of the Worker that has room for 3 overlays on 2 channels. */
const cappedScenarios = {
    async "hub-full"(t) {
        const first = t.overlay("e2e_full_a");
        await first.join();
        // Both find room when they connect, and only one of their channels fits.
        const second = t.overlay("e2e_full_b");
        const third = t.overlay("e2e_full_c");
        expect((await second.opened) && (await third.opened), "the relay refused a socket");
        await second.join();
        await third.login();
        await until(() => third.closed, LINE_TIMEOUT_MS, 10);
        expect(third.closed, "the overlay of a channel too many stayed connected");
        expect(third.closed.code === 1013, `closed with ${third.closed.code} instead of 1013`);
        expect(third.echoes().length === 0, "the JOIN of a channel too many was echoed");
        const joins = await t.mock.events(third.channel, "join");
        expect(joins.length === 0, "the channel too many reached Twitch");

        const channelPath = "/api/irc?channel=e2e_full_d";
        expectRefusal(await upgradeRequest(t.worker, channelPath), 503, "a third channel");
        const fourth = t.overlay(first.channel);
        await fourth.join();
        const clientPath = `/api/irc?channel=${first.channel}`;
        expectRefusal(await upgradeRequest(t.worker, clientPath), 503, "a fourth overlay");

        const response = await fetch(`${t.worker.origin}/api/status`, AS_OVERLAY);
        const [shard] = (await response.json()).shards;
        expect(
            shard.limits?.clients === CAPPED_CLIENTS && shard.limits?.channels === CAPPED_CHANNELS,
            "the status does not tell the limits of the hub",
        );
        expect(shard.clients === CAPPED_CLIENTS, `${shard.clients} overlays counted at the limit`);

        // Once overlays left there is room again, and a channel nobody watches gives way.
        second.close();
        fourth.close();
        const fifth = await until(
            async () => {
                const overlay = t.overlay("e2e_full_e");
                return (await overlay.opened) ? overlay : undefined;
            },
            LINE_TIMEOUT_MS,
            250,
        );
        expect(fifth, "no room for a new channel although overlays left");
        const echo = await fifth.join();
        const parts = await until(
            async () => (await t.mock.events(second.channel, "part"))[0],
            LINE_TIMEOUT_MS,
        );
        expect(parts, "the channel nobody watches did not give way");
        const [id] = await t.mock.say(fifth.channel);
        expect(await fifth.waitForId(id), "the new channel got no chat");
        return `JOIN echo of the new channel ${echo.at - fifth.joinSentAt} ms after JOIN`;
    },
};

/** Run against a second start of the Worker, with the emergency switch thrown. */
const disabledScenarios = {
    async "relay-disabled"(t) {
        const startedAt = Date.now();
        const response = await upgradeRequest(t.worker, "/api/irc?channel=e2e_disabled");
        const took = Date.now() - startedAt;
        expectRefusal(response, 503, "socket while the relay is off");
        const { counts } = await t.mock.state();
        expect(counts.opened === t.openedBefore, "a disabled relay connected to Twitch");

        const status = await fetch(`${t.worker.origin}/api/status`, AS_OVERLAY);
        expect(status.status === 200, `the status answered ${status.status}`);
        expect((await status.json()).relayEnabled === false, "the status calls the relay enabled");
        const refused = await rawRequest(t.worker, "/api/data/example/v1/emotes");
        expect(refused.headers[CACHE_HEADER], "the data gateway does not answer any more");
        return `refused after ${took} ms`;
    },
};

class Skipped {
    constructor(reason) {
        this.reason = reason;
    }
}

/** Runs one scenario and prints its line. Returns `passed`, `failed` or `skipped`. */
async function runScenario(name, scenario, context) {
    const overlays = [];
    let nextNick = 1;
    const t = {
        ...context,
        openedBefore: (await context.mock.state()).counts.opened,
        skip: (reason) => new Skipped(reason),
        overlay(channel) {
            context.channels.add(channel);
            const nick = `justinfan${context.nickBase + nextNick++}`;
            const overlay = new Overlay(context.worker.socketOrigin, channel, nick);
            overlays.push(overlay);
            return overlay;
        },
    };
    let timer;
    const startedAt = Date.now();
    try {
        const outcome = await Promise.race([
            scenario(t),
            new Promise((_, fail) => {
                timer = setTimeout(
                    () => fail(new Failure(`not finished after ${SCENARIO_TIMEOUT_MS / 1000} s`)),
                    SCENARIO_TIMEOUT_MS,
                );
            }),
        ]);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (outcome instanceof Skipped) {
            console.log(`SKIP  ${name}  ${outcome.reason}`);
            return "skipped";
        }
        console.log(`PASS  ${name}  ${outcome ? `${outcome}, ` : ""}${seconds} s`);
        return "passed";
    } catch (error) {
        // A failed expectation explains itself; anything else is a fault of the suite or of
        // the connection to the Worker, where the stack says more.
        const reason = error instanceof Failure ? error.message : (error?.stack ?? String(error));
        console.log(`FAIL  ${name}  ${reason}`);
        return "failed";
    } finally {
        clearTimeout(timer);
        for (const overlay of overlays) overlay.close();
    }
}

async function main() {
    const settings = readSettings();
    const groups = [scenarios, cappedScenarios, disabledScenarios];
    const known = groups.flatMap((group) => Object.keys(group));
    const unknown = settings.only.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
        throw new SetupError(
            `unknown scenario ${unknown.join(", ")}; there are: ${known.join(", ")}`,
        );
    }
    const selected = (group) =>
        Object.entries(group).filter(
            ([name]) => settings.only.length === 0 || settings.only.includes(name),
        );

    const cleanup = [];
    const results = { passed: 0, failed: 0, skipped: 0 };
    const shutdown = async () => {
        for (const step of cleanup.reverse().splice(0)) {
            await step().catch((error) => {
                results.failed++;
                console.error(`cleanup failed: ${error.message}`);
            });
        }
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.once(signal, () => {
            shutdown().finally(() => process.exit(130));
        });
    }

    try {
        let stateDirectory = settings.state;
        if (stateDirectory) {
            await mkdir(stateDirectory, { recursive: true });
        } else {
            const temporary = await mkdtemp(join(tmpdir(), "petal-e2e-"));
            stateDirectory = temporary;
            cleanup.push(() => rm(temporary, { recursive: true, force: true }));
        }
        if (!(await isFree(settings.mockPort))) {
            throw new SetupError(`port ${settings.mockPort} is in use`);
        }
        const mock = await startMockTwitch({ port: settings.mockPort });
        cleanup.push(() => mock.close());
        const variables = {
            TWITCH_IRC_URL: mock.url,
            // One hub, so that every channel of the suite shares one pool of connections.
            RELAY_SHARDS: "1",
            RELAY_ENABLED: "true",
            PART_GRACE_MS: String(PART_GRACE_MS),
            WATCHDOG_MS: String(WATCHDOG_MS),
            REPLAY_LINES: String(REPLAY_LINES),
            MAX_CHANNELS_PER_UPSTREAM: String(MAX_CHANNELS_PER_UPSTREAM),
        };
        const context = {
            mock: mockControl(mock),
            offline: settings.offline,
            channels: new Set(),
            // Nicks differ between overlays, so an echo with the wrong one is noticed.
            nickBase: 10_000,
        };

        const capped = {
            MAX_CLIENTS_PER_HUB: String(CAPPED_CLIENTS),
            MAX_CHANNELS_PER_HUB: String(CAPPED_CHANNELS),
        };
        const phases = [
            [selected(scenarios), variables],
            [selected(cappedScenarios), { ...variables, ...capped }],
            [selected(disabledScenarios), { ...variables, RELAY_ENABLED: "false" }],
        ];
        for (const [group, phaseVariables] of phases) {
            if (group.length === 0) continue;
            const worker = await startWorker(settings, stateDirectory, phaseVariables);
            const stop = () => worker.stop();
            cleanup.push(stop);
            for (const [name, scenario] of group) {
                results[await runScenario(name, scenario, { ...context, worker })]++;
                context.nickBase += 100;
            }
            cleanup.splice(cleanup.indexOf(stop), 1);
            await worker.stop();
        }
    } finally {
        await shutdown();
    }
    console.log(`${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
    return results.failed === 0 ? 0 : 1;
}

try {
    process.exit(await main());
} catch (error) {
    console.error(error instanceof SetupError ? `e2e: ${error.message}` : error);
    process.exit(2);
}
