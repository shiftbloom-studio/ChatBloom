import { type IrcLineInfo, inspectIrcLine, tagValue } from "./irc";

export interface UpstreamConfig {
    url: string;
    maxChannelsPerConnection: number;
    /**
     * JOIN budget of one connection. Twitch documents 20 attempts per 10 seconds per user; the
     * margin keeps a burst that straddles Twitch's window boundary under the limit.
     */
    joinsPerWindow: number;
    joinWindowMs: number;
    /** Twitch drops a JOIN it does not like without an answer, so silence is the only signal. */
    joinTimeoutMs: number;
    connectTimeoutMs: number;
    /** Twitch documents 20 logins per 10 seconds; this spacing stays below that per pool. */
    connectSpacingMs: number;
    /** A connection that stayed quiet this long is probed with a PING. */
    idlePingMs: number;
    pongTimeoutMs: number;
    /** How long a connection that was told to RECONNECT keeps serving while its channels move. */
    drainTimeoutMs: number;
    /** A connection without channels is kept this long, so a scene reload does not reconnect. */
    idleCloseMs: number;
    maxBackoffMs: number;
}

export const UPSTREAM_DEFAULTS: Omit<UpstreamConfig, "url"> = {
    maxChannelsPerConnection: 50,
    joinsPerWindow: 18,
    joinWindowMs: 10_500,
    joinTimeoutMs: 10_000,
    connectTimeoutMs: 10_000,
    connectSpacingMs: 600,
    idlePingMs: 30_000,
    pongTimeoutMs: 10_000,
    drainTimeoutMs: 60_000,
    idleCloseMs: 30_000,
    maxBackoffMs: 30_000,
};

export type UpstreamCounter =
    | "connect"
    | "connect-failed"
    | "ready"
    | "closed"
    | "reconnect-requested"
    | "silent"
    | "join-sent"
    | "join-confirmed"
    | "join-timeout"
    | "part-sent"
    | "parted-by-twitch"
    | "stray-channel"
    | "handover"
    | "duplicate-dropped"
    | "line"
    | "failed";

export interface UpstreamEvents {
    /** A forwardable line of a wanted channel, already de-duplicated across connections. */
    line(channel: string, line: string, info: IrcLineInfo): void;
    /** Twitch confirmed the JOIN. Its ROOMSTATE follows as a regular line. */
    joined(channel: string): void;
    /** The connection that delivered the channel is gone; a new JOIN is on its way. */
    lost(channel: string): void;
    count(name: UpstreamCounter): void;
}

/** The part of a connection the pool talks to. */
export interface UpstreamSocket {
    send(data: string): void;
    close(code?: number): void;
}

export interface UpstreamSocketEvents {
    open(): void;
    /** One text frame; it may hold several lines. */
    frame(data: string): void;
    /** The connection is gone. May be called more than once. */
    closed(): void;
}

/** Everything the pool takes from its surroundings, so tests run it on a clock of their own. */
export interface UpstreamRuntime {
    now(): number;
    /** Like `Math.random`. */
    random(): number;
    connect(url: string, events: UpstreamSocketEvents): UpstreamSocket;
    /** Calls `run` every `intervalMs` until the returned function is called. */
    every(intervalMs: number, run: () => void): () => void;
}

/**
 * The standard constructor instead of `fetch` with an upgrade header: it keeps this file free
 * of Workers-only APIs, so the same code runs under plain Node.
 */
export const SYSTEM_RUNTIME: UpstreamRuntime = {
    now: () => Date.now(),
    random: () => Math.random(),
    connect(url, events) {
        const socket = new WebSocket(url);
        socket.addEventListener("open", () => events.open());
        socket.addEventListener("message", (event) => {
            // Twitch IRC is text only; a binary frame is not something to interpret.
            if (typeof event.data === "string") events.frame(event.data);
        });
        // The runtime reports a lost connection as `close`, `error`, or both in either order.
        socket.addEventListener("close", () => events.closed());
        socket.addEventListener("error", () => events.closed());
        return socket;
    },
    every(intervalMs, run) {
        const timer = setInterval(run, intervalMs);
        return () => clearInterval(timer);
    },
};

export type ConnectionState = "connecting" | "registering" | "ready" | "draining" | "closed";

export interface ConnectionStatus {
    id: number;
    state: ConnectionState;
    channels: number;
    queuedJoins: number;
    ageMs: number;
    quietMs: number;
}

export interface UpstreamStatus {
    wanted: number;
    joined: number;
    connections: ConnectionStatus[];
    consecutiveFailures: number;
}

interface Connection {
    id: number;
    /** Missing only while the connection is being opened. */
    socket: UpstreamSocket | undefined;
    state: ConnectionState;
    nick: string;
    /** Every channel that is queued, joining or joined here; bounds the connection's size. */
    channels: Set<string>;
    /** Channels whose JOIN waits for budget, in arrival order. */
    queue: string[];
    /** Send times of the JOINs inside the current rate limit window. */
    joinTimes: number[];
    /**
     * Channels that were told to PART and have not confirmed it, with the time of the PART.
     * Twitch answers in the order it was asked, so until the PART is confirmed a JOIN echo or a
     * chat line of that channel belongs to the membership that is ending.
     */
    parting: Map<string, number>;
    startedAt: number;
    readyAt: number;
    lastHeardAt: number;
    /** 0 while no PING is unanswered. */
    pingSentAt: number;
    drainingSince: number;
    emptySince: number;
}

interface ChannelEntry {
    /** Delivers the channel: Twitch confirmed the JOIN there. */
    live: Connection | undefined;
    /** The JOIN is queued or unconfirmed there. */
    target: Connection | undefined;
    /** Still joined there after a handover, until its PART is confirmed. */
    previous: Connection | undefined;
    /** 0 while the JOIN has not left the queue. */
    joinSentAt: number;
    attempts: number;
    retryAt: number;
    /** Message ids seen while, and shortly after, two connections deliver the channel. */
    overlap: Set<string> | undefined;
    /** 0 while two connections deliver; afterwards the time at which `overlap` is dropped. */
    overlapEndsAt: number;
}

/** Only these reach overlays; everything else on the connection is protocol housekeeping. */
const FORWARDED = new Set([
    "PRIVMSG",
    "USERNOTICE",
    "CLEARCHAT",
    "CLEARMSG",
    "ROOMSTATE",
    "NOTICE",
]);

const PUMP_MS = 1000;
/** A connection that fails sooner than this after login counts as a failed attempt. */
const STABLE_MS = 10_000;
const MAX_JOIN_RETRY_MS = 300_000;
/** The new connection may lag behind the old one by this much when the old one leaves. */
const OVERLAP_TAIL_MS = 10_000;
/** A busy channel sends some 50 lines per second while a handover takes a second or two. */
const MAX_OVERLAP_IDS = 4096;

/**
 * Keeps the wanted channels joined on as few anonymous Twitch IRC connections as the JOIN rate
 * limit allows, and replaces connections that fail, fall silent or are told to RECONNECT.
 *
 * All timing runs through `pump()`, which is idempotent: a timer calls it every second, and the
 * Durable Object alarm calls it as a watchdog.
 */
export class UpstreamPool {
    #config: UpstreamConfig;
    #events: UpstreamEvents;
    #runtime: UpstreamRuntime;
    #wanted = new Map<string, ChannelEntry>();
    #connections = new Set<Connection>();
    #nextId = 1;
    #stopTimer: (() => void) | undefined;
    #lastConnectAt = 0;
    #nextConnectAt = 0;
    #failures = 0;
    #pumping = false;
    #pumpAgain = false;

    constructor(
        config: UpstreamConfig,
        events: UpstreamEvents,
        runtime: UpstreamRuntime = SYSTEM_RUNTIME,
    ) {
        this.#config = config;
        this.#events = events;
        this.#runtime = runtime;
    }

    want(channel: string): void {
        if (this.#wanted.has(channel)) return;
        this.#wanted.set(channel, {
            live: undefined,
            target: undefined,
            previous: undefined,
            joinSentAt: 0,
            attempts: 0,
            retryAt: 0,
            overlap: undefined,
            overlapEndsAt: 0,
        });
        this.#stopTimer ??= this.#runtime.every(PUMP_MS, () => this.#guarded(() => this.pump()));
        this.pump();
    }

    release(channel: string): void {
        const entry = this.#wanted.get(channel);
        if (!entry) return;
        this.#wanted.delete(channel);
        const now = this.#runtime.now();
        for (const connection of [entry.live, entry.target, entry.previous]) {
            if (!connection?.channels.has(channel)) continue;
            const queued = connection === entry.target && entry.joinSentAt === 0;
            if (queued) connection.queue = connection.queue.filter((name) => name !== channel);
            else this.#part(connection, channel, now);
            this.#forget(connection, channel, now);
        }
    }

    isJoined(channel: string): boolean {
        return this.#wanted.get(channel)?.live !== undefined;
    }

    /** Closes every connection and forgets every channel, so nothing keeps the object alive. */
    shutdown(): void {
        this.#stopTimer?.();
        this.#stopTimer = undefined;
        this.#wanted.clear();
        const now = this.#runtime.now();
        for (const connection of [...this.#connections]) this.#retire(connection, now);
        this.#failures = 0;
        this.#nextConnectAt = 0;
    }

    status(now = this.#runtime.now()): UpstreamStatus {
        let joined = 0;
        for (const entry of this.#wanted.values()) if (entry.live) joined++;
        return {
            wanted: this.#wanted.size,
            joined,
            connections: [...this.#connections].map((connection) => ({
                id: connection.id,
                state: connection.state,
                channels: connection.channels.size,
                queuedJoins: connection.queue.length,
                ageMs: now - connection.startedAt,
                quietMs: now - connection.lastHeardAt,
            })),
            consecutiveFailures: this.#failures,
        };
    }

    pump(now = this.#runtime.now()): void {
        // A connection that fails during a pass asks for another pass instead of nesting one.
        if (this.#pumping) {
            this.#pumpAgain = true;
            return;
        }
        this.#pumping = true;
        try {
            do {
                this.#pumpAgain = false;
                for (const connection of [...this.#connections]) this.#supervise(connection, now);
                for (const [channel, entry] of this.#wanted) this.#place(channel, entry, now);
                for (const connection of [...this.#connections]) this.#flushJoins(connection, now);
            } while (this.#pumpAgain);
        } finally {
            this.#pumping = false;
        }
        if (this.#wanted.size === 0 && this.#connections.size === 0) {
            // A pending timer keeps a Durable Object from hibernating.
            this.#stopTimer?.();
            this.#stopTimer = undefined;
        }
    }

    #supervise(connection: Connection, now: number): void {
        const config = this.#config;
        if (connection.state === "closed") return;
        if (connection.state === "connecting" || connection.state === "registering") {
            if (now - connection.startedAt > config.connectTimeoutMs) this.#fail(connection);
            return;
        }
        for (const [channel, since] of connection.parting) {
            // Twitch does not confirm the PART of a channel that was never joined.
            if (now - since > config.joinTimeoutMs) connection.parting.delete(channel);
        }
        if (connection.pingSentAt > 0) {
            if (now - connection.pingSentAt > config.pongTimeoutMs) {
                this.#events.count("silent");
                this.#fail(connection);
                return;
            }
        } else if (now - connection.lastHeardAt >= config.idlePingMs) {
            connection.pingSentAt = now;
            if (!this.#send(connection, "PING :petal-hub")) return;
        }
        if (connection.state === "draining") {
            const expired = now - connection.drainingSince > config.drainTimeoutMs;
            if (connection.channels.size === 0 || expired) this.#fail(connection);
            return;
        }
        if (connection.channels.size === 0 && now - connection.emptySince > config.idleCloseMs) {
            this.#retire(connection, now);
        }
    }

    /** Gives a channel that is not being delivered, or is about to lose its connection, a target. */
    #place(channel: string, entry: ChannelEntry, now: number): void {
        if (entry.overlap && entry.overlapEndsAt > 0 && now >= entry.overlapEndsAt) {
            entry.overlap = undefined;
            entry.overlapEndsAt = 0;
        }
        const target = entry.target;
        if (target) {
            const unanswered =
                entry.joinSentAt > 0 && now - entry.joinSentAt > this.#config.joinTimeoutMs;
            if (!unanswered) return;
            // Nonexistent channels never answer. Backing off keeps them from eating the budget.
            this.#events.count("join-timeout");
            this.#forget(target, channel, now);
            entry.target = undefined;
            entry.joinSentAt = 0;
            this.#backOff(entry, now);
        }
        const delivered = entry.live !== undefined && entry.live.state !== "draining";
        if (delivered || now < entry.retryAt) return;
        const connection = this.#pick(channel, now);
        if (!connection) return;
        connection.channels.add(channel);
        connection.queue.push(channel);
        entry.target = connection;
    }

    #backOff(entry: ChannelEntry, now: number): void {
        entry.attempts++;
        const delay = this.#config.joinTimeoutMs * 2 ** (entry.attempts - 1);
        entry.retryAt = now + Math.min(MAX_JOIN_RETRY_MS, delay);
    }

    /**
     * Prefers the connection with the most JOIN budget left, and opens another one rather than
     * waiting for budget: after a restart every channel wants its JOIN at once, and a fresh
     * connection brings a fresh budget.
     */
    #pick(channel: string, now: number): Connection | undefined {
        let best: Connection | undefined;
        let bestBudget = 0;
        let waiting: Connection | undefined;
        for (const connection of this.#connections) {
            if (connection.state === "draining" || connection.state === "closed") continue;
            if (connection.channels.size >= this.#config.maxChannelsPerConnection) continue;
            if (connection.parting.has(channel)) continue;
            const budget = this.#budget(connection, now) - connection.queue.length;
            if (budget > bestBudget) {
                best = connection;
                bestBudget = budget;
            }
            waiting ??= connection;
        }
        if (best) return best;
        const mayConnect =
            now >= this.#nextConnectAt &&
            now - this.#lastConnectAt >= this.#config.connectSpacingMs;
        if (mayConnect) return this.#open(now);
        // Backing off after failures: queueing behind an existing budget beats not queueing.
        return this.#failures > 0 ? waiting : undefined;
    }

    #budget(connection: Connection, now: number): number {
        const times = connection.joinTimes;
        while (times.length > 0 && now - (times[0] as number) >= this.#config.joinWindowMs) {
            times.shift();
        }
        return this.#config.joinsPerWindow - times.length;
    }

    #flushJoins(connection: Connection, now: number): void {
        if (connection.state !== "ready") return;
        while (connection.queue.length > 0 && this.#budget(connection, now) > 0) {
            const channel = connection.queue.shift() as string;
            const entry = this.#wanted.get(channel);
            if (entry?.target !== connection || entry.joinSentAt > 0) continue;
            if (!this.#send(connection, `JOIN #${channel}`)) return;
            connection.joinTimes.push(now);
            entry.joinSentAt = now;
            this.#events.count("join-sent");
        }
    }

    #open(now: number): Connection | undefined {
        const connection: Connection = {
            id: this.#nextId++,
            socket: undefined,
            state: "connecting",
            nick: `justinfan${10_000 + Math.floor(this.#runtime.random() * 89_999)}`,
            channels: new Set(),
            queue: [],
            joinTimes: [],
            parting: new Map(),
            startedAt: now,
            readyAt: 0,
            lastHeardAt: now,
            pingSentAt: 0,
            drainingSince: 0,
            emptySince: now,
        };
        this.#lastConnectAt = now;
        this.#events.count("connect");
        try {
            connection.socket = this.#runtime.connect(this.#config.url, {
                open: () => this.#guarded(() => this.#opened(connection)),
                frame: (data) => this.#receive(connection, data),
                closed: () => this.#guarded(() => this.#fail(connection)),
            });
        } catch {
            // A malformed address, or a runtime that refuses another connection.
            connection.state = "closed";
            this.#events.count("connect-failed");
            this.#delayConnect(now);
            return undefined;
        }
        this.#connections.add(connection);
        return connection;
    }

    #opened(connection: Connection): void {
        if (connection.state !== "connecting") return;
        connection.state = "registering";
        // Twitch closes a connection that has not logged in after 30 seconds.
        if (!this.#send(connection, "CAP REQ :twitch.tv/tags twitch.tv/commands")) return;
        this.#send(connection, `NICK ${connection.nick}`);
    }

    #receive(connection: Connection, frame: string): void {
        if (connection.state === "closed") return;
        connection.lastHeardAt = this.#runtime.now();
        connection.pingSentAt = 0;
        let start = 0;
        while (start < frame.length) {
            let end = frame.indexOf("\r\n", start);
            if (end === -1) end = frame.length;
            if (end > start) {
                const line = frame.slice(start, end);
                this.#guarded(() => this.#line(connection, line));
            }
            start = end + 2;
        }
    }

    /**
     * For everything the runtime calls on its own. What is thrown there reaches nobody who
     * could act on it, and the runtime would write it to the log with whatever it says.
     */
    #guarded(work: () => void): void {
        try {
            work();
        } catch {
            this.#events.count("failed");
        }
    }

    #line(connection: Connection, line: string): void {
        const info = inspectIrcLine(line);
        if (!info) return;
        switch (info.command) {
            case "PING":
                this.#send(connection, `PONG ${line.slice(line.indexOf(" ") + 1)}`);
                return;
            case "001":
                this.#registered(connection);
                return;
            case "RECONNECT":
                this.#drain(connection);
                return;
            case "JOIN":
                if (info.channel && this.#isOwn(connection, line, info)) {
                    this.#confirm(connection, info.channel);
                }
                return;
            case "PART":
                if (info.channel && this.#isOwn(connection, line, info)) {
                    this.#parted(connection, info.channel);
                }
                return;
        }
        if (info.channel && FORWARDED.has(info.command)) {
            this.#deliver(connection, info.channel, line, info);
        }
    }

    #isOwn(connection: Connection, line: string, info: IrcLineInfo): boolean {
        return line.startsWith(`:${connection.nick}!`, info.bodyStart);
    }

    #registered(connection: Connection): void {
        if (connection.state !== "registering") return;
        const now = this.#runtime.now();
        connection.state = "ready";
        connection.readyAt = now;
        this.#events.count("ready");
        this.#flushJoins(connection, now);
    }

    #confirm(connection: Connection, channel: string): void {
        if (connection.parting.has(channel)) return;
        const entry = this.#wanted.get(channel);
        if (entry?.live === connection) return;
        if (entry?.target !== connection) {
            // An echo that arrives after its timeout is still a JOIN: keep it if nobody else
            // has the channel, instead of parting and joining again.
            const free = entry && !entry.live && !entry.target && connection.state === "ready";
            if (!free) {
                this.#unwanted(connection, channel);
                return;
            }
            connection.channels.add(channel);
        }
        const old = entry.live;
        entry.live = connection;
        entry.target = undefined;
        entry.joinSentAt = 0;
        entry.attempts = 0;
        entry.retryAt = 0;
        this.#failures = 0;
        this.#events.count("join-confirmed");
        if (old && old.state !== "closed") {
            entry.previous = old;
            entry.overlapEndsAt = 0;
            this.#events.count("handover");
            this.#part(old, channel, this.#runtime.now());
        }
        this.#events.joined(channel);
    }

    /** Joined to a channel that was released, or moved elsewhere, in the meantime. */
    #unwanted(connection: Connection, channel: string): void {
        const now = this.#runtime.now();
        this.#forget(connection, channel, now);
        this.#part(connection, channel, now);
    }

    #parted(connection: Connection, channel: string): void {
        const now = this.#runtime.now();
        connection.parting.delete(channel);
        const entry = this.#wanted.get(channel);
        // The membership that ended is an older one: the JOIN waiting here comes after it.
        if (entry?.target === connection) return;
        this.#forget(connection, channel, now);
        if (!entry) return;
        if (entry.previous === connection) {
            entry.previous = undefined;
            entry.overlapEndsAt = now + OVERLAP_TAIL_MS;
        }
        if (entry.live !== connection) return;
        // Not asked for. Joining again at once could loop, so the channel waits like one
        // whose JOIN went unanswered.
        this.#events.count("parted-by-twitch");
        entry.live = undefined;
        this.#backOff(entry, now);
        this.#events.lost(channel);
    }

    #deliver(connection: Connection, channel: string, line: string, info: IrcLineInfo): void {
        const entry = this.#wanted.get(channel);
        // After a handover the old connection delivers until its PART is confirmed, in case
        // the new one lags. Any other channel that is leaving has nobody to deliver to.
        if (connection.parting.has(channel) && connection !== entry?.previous) return;
        if (entry?.target === connection && info.command !== "NOTICE") {
            // A suspended channel answers the JOIN with a NOTICE instead of an echo. Anything
            // else can only arrive on a joined channel, whatever became of the echo.
            if (entry.joinSentAt === 0) return;
            this.#confirm(connection, channel);
        }
        const known =
            entry !== undefined &&
            (connection === entry.live ||
                connection === entry.previous ||
                connection === entry.target);
        if (!known) {
            // Joined here without anyone knowing. Left alone, the channel would be delivered
            // to nobody for as long as the connection lives.
            this.#events.count("stray-channel");
            this.#unwanted(connection, channel);
            return;
        }
        if (entry.overlap) {
            const id = tagValue(line, info, "id");
            if (id === undefined) {
                // Without an id there is nothing to compare, so one side has to win.
                if (entry.live !== undefined && connection !== entry.live) return;
            } else if (entry.overlap.has(id)) {
                this.#events.count("duplicate-dropped");
                return;
            } else {
                this.#remember(entry.overlap, id);
            }
        }
        this.#events.count("line");
        this.#events.line(channel, line, info);
    }

    #remember(overlap: Set<string>, id: string): void {
        overlap.add(id);
        if (overlap.size <= MAX_OVERLAP_IDS) return;
        // Sets keep insertion order, so the first id is the oldest.
        for (const oldest of overlap) {
            overlap.delete(oldest);
            return;
        }
    }

    /**
     * RECONNECT announces that Twitch will close the connection soon. Its channels are joined
     * elsewhere first and only then parted here, so overlays do not see a gap.
     */
    #drain(connection: Connection): void {
        if (connection.state !== "ready") return;
        const now = this.#runtime.now();
        connection.state = "draining";
        connection.drainingSince = now;
        connection.queue.length = 0;
        this.#events.count("reconnect-requested");
        for (const [channel, entry] of this.#wanted) {
            if (entry.target === connection) {
                entry.target = undefined;
                entry.joinSentAt = 0;
                connection.channels.delete(channel);
            }
            if (entry.live === connection) {
                entry.overlap = new Set();
                entry.overlapEndsAt = 0;
            }
        }
        this.pump(now);
    }

    #fail(connection: Connection): void {
        if (connection.state === "closed") return;
        const now = this.#runtime.now();
        const planned = connection.state === "draining";
        const stable = connection.readyAt > 0 && now - connection.readyAt >= STABLE_MS;
        if (!planned && !stable) {
            this.#events.count("connect-failed");
            this.#delayConnect(now);
        }
        this.#retire(connection, now);
        if (this.#wanted.size > 0) this.pump(now);
    }

    #delayConnect(now: number): void {
        this.#failures++;
        const ceiling = Math.min(this.#config.maxBackoffMs, 1000 * 2 ** (this.#failures - 1));
        this.#nextConnectAt = now + ceiling * (0.5 + this.#runtime.random());
    }

    /** Ends the connection and frees every channel that depended on it. */
    #retire(connection: Connection, now: number): void {
        connection.state = "closed";
        this.#connections.delete(connection);
        this.#events.count("closed");
        try {
            connection.socket?.close(1000);
        } catch {
            // Already closed by the other side; the socket is dropped either way.
        }
        for (const [channel, entry] of this.#wanted) {
            if (entry.previous === connection) {
                entry.previous = undefined;
                entry.overlapEndsAt = now + OVERLAP_TAIL_MS;
            }
            if (entry.target === connection) {
                entry.target = undefined;
                entry.joinSentAt = 0;
            }
            if (entry.live === connection) {
                entry.live = undefined;
                this.#events.lost(channel);
            }
        }
    }

    #forget(connection: Connection, channel: string, now: number): void {
        if (!connection.channels.delete(channel)) return;
        if (connection.channels.size === 0) connection.emptySince = now;
    }

    #part(connection: Connection, channel: string, now: number): void {
        if (connection.state !== "ready" && connection.state !== "draining") return;
        if (connection.parting.has(channel)) return;
        if (!this.#send(connection, `PART #${channel}`)) return;
        connection.parting.set(channel, now);
        this.#events.count("part-sent");
    }

    #send(connection: Connection, line: string): boolean {
        try {
            connection.socket?.send(line);
            return true;
        } catch {
            this.#fail(connection);
            return false;
        }
    }
}
