import type { IrcLineInfo } from "./irc";
import { MinuteCounter } from "./minute";
import { mergeRoomstate, ReplayBuffer } from "./replay";
import { normaliseChannel } from "./shard";
import {
    type UpstreamConfig,
    UpstreamPool,
    type UpstreamRuntime,
    type UpstreamStatus,
} from "./upstream";

/** The overlay's keep-alive, answered by the runtime without waking the object. */
export const CLIENT_PING = "PING :petal";
export const CLIENT_PONG = ":tmi.twitch.tv PONG tmi.twitch.tv :petal";

export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_UNSUPPORTED = 1003;
/** The overlay did not keep to the protocol; connecting again the same way will not help. */
export const CLOSE_POLICY = 1008;
export const CLOSE_TOO_BIG = 1009;
export const CLOSE_INTERNAL = 1011;
/** The hub is full, or has paused itself. */
export const CLOSE_OVERLOADED = 1013;

/** What a refused overlay is told to wait when the hub cannot say when there will be room. */
const RETRY_AFTER_SECONDS = 30;

/** Why a hub paused itself: the threshold that was exceeded. */
export type PauseReason = "clients" | "channels" | "connects" | "lines" | "frames";
const PAUSE_REASONS: readonly unknown[] = ["clients", "channels", "connects", "lines", "frames"];

export interface HubConfig {
    upstream: UpstreamConfig;
    /** Chat lines kept per channel for overlays that join late or reload. */
    replayLines: number;
    /** A channel without overlays stays joined this long, so a scene reload finds it joined. */
    graceMs: number;
    /**
     * Must stay well below 70 seconds: once an upstream connection is older than 15 minutes
     * only incoming events such as the alarm keep the object in memory.
     */
    watchdogMs: number;
    maxClients: number;
    maxChannels: number;
    /** In UTF-16 code units. Everything an overlay has to say fits into a tenth of it. */
    maxFrameLength: number;
    /**
     * An overlay sends three frames, and the runtime answers its keep-alive without handing it
     * to the hub. Every frame that does arrive is a billed event and a line in the log, and
     * none of the thresholds below counts them: a connection that keeps talking is closed.
     */
    maxFrames: number;
    /** An overlay sends its JOIN right after connecting; a socket that does not is not one. */
    joinDeadlineMs: number;
    /**
     * An overlay sends its keep-alive every minute. A socket that stayed silent this long has
     * lost its overlay without the network noticing.
     */
    staleClientMs: number;
    /**
     * The safety switch: above one of these four the hub pauses itself, and 0 switches one
     * off. Those for overlays and channels sit below `maxClients` and `maxChannels`, which
     * refuse the overlay that is one too many and keep serving the others.
     */
    pauseClients: number;
    pauseChannels: number;
    /**
     * Must stay above `pauseClients`: a deployment makes every overlay connect again at once,
     * and that wave is not a flood.
     */
    pauseConnectsPerMinute: number;
    pauseLinesPerMinute: number;
    /**
     * Frames from overlays, whoever sent them. Must stay above three times `pauseClients`: an
     * overlay connects with three frames, and after a deployment all of them do so at once.
     */
    pauseFramesPerMinute: number;
    /** At least a minute, which is what the counters of connections and lines look back. */
    pauseMs: number;
}

export const HUB_DEFAULTS: Omit<HubConfig, "upstream"> = {
    replayLines: 50,
    graceMs: 60_000,
    watchdogMs: 30_000,
    maxClients: 5000,
    maxChannels: 1000,
    maxFrameLength: 1024,
    maxFrames: 20,
    joinDeadlineMs: 30_000,
    staleClientMs: 600_000,
    pauseClients: 2000,
    pauseChannels: 500,
    pauseConnectsPerMinute: 3000,
    pauseLinesPerMinute: 300_000,
    pauseFramesPerMinute: 10_000,
    pauseMs: 900_000,
};

/** The part of a hibernatable WebSocket the hub uses. */
export interface ClientSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
}

/** Counters of one alarm, for Analytics Engine. Counts only. */
export interface HubTick {
    clients: number;
    channels: number;
    upstreamConnections: number;
    joinedChannels: number;
    /** This and the following: since the previous alarm. */
    lines: number;
    accepted: number;
    refused: number;
    upstreamFailures: number;
}

/** What is told about a pause that starts. Counts only. */
export interface PauseStart {
    reason: PauseReason;
    /** What the hub counted, and the threshold this exceeded. */
    measured: number;
    threshold: number;
}

/** Everything the hub takes from the Durable Object around it. */
export interface HubHost<Socket extends ClientSocket> {
    now(): number;
    /** Every client socket the runtime holds for the object. */
    sockets(): Socket[];
    /** When the runtime last answered the socket's keep-alive, if it ever did. */
    keptAliveAt(socket: Socket): number | undefined;
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
    /**
     * The end of a pause and its reason are all the hub ever keeps in storage, so that a hub
     * that is built again inside its pause stays paused. Both are missing while there is none.
     */
    storedPause(): Promise<{ until?: unknown; reason?: unknown }>;
    storePause(until: number, reason: PauseReason): Promise<void>;
    forgetPause(): Promise<void>;
    report(tick: HubTick): void;
    /**
     * Resets the object, which is the only way to be rid of a socket whose other side does not
     * answer the close: until then the runtime keeps delivering its frames.
     */
    reset(): void;
    paused(pause: PauseStart): void;
    resumed(reason: PauseReason): void;
}

/** What `/api/status` tells about one hub. Counts only: no channel, no name, no chat. */
export interface HubStatus {
    /** `null` until somebody told the hub which one it is. */
    shard: number | null;
    /** Changes whenever the object is built again. */
    instance: string;
    uptimeMs: number;
    /** Sockets the runtime holds, including those that are closing. */
    sockets: number;
    clients: number;
    /** Clients that have not sent their JOIN yet. */
    pendingClients: number;
    channels: number;
    /** Channels kept joined for overlays that may come back. */
    idleChannels: number;
    replayLines: number;
    alarmInMs: number | null;
    limits: { clients: number; channels: number };
    /** `null` while the hub is open. */
    pause: { reason: PauseReason; remainingMs: number } | null;
    /** Above these the hub pauses itself for `pauseMs`; 0 means that one is switched off. */
    thresholds: {
        clients: number;
        channels: number;
        connectsPerMinute: number;
        linesPerMinute: number;
        framesPerMinute: number;
        pauseMs: number;
    };
    upstream: UpstreamStatus;
    counters: Record<string, number>;
}

export type HubRefusal = "hub_full" | "channels_full" | "relay_paused";

/** `waiting` has sent JOIN, `live` has received the JOIN echo. */
type ClientPhase = "new" | "waiting" | "live";

/** Survives with the socket when the object is built again; the runtime allows 16,384 bytes. */
interface ClientAttachment {
    channel: string;
    nick: string;
    phase: ClientPhase;
    /** When the socket was accepted. */
    since: number;
}

interface Client<Socket> extends ClientAttachment {
    socket: Socket;
    /** The last sign of life the hub knows of. */
    heardAt: number;
    /** Frames received since the hub took the connection up. */
    frames: number;
}

interface HubChannel<Socket> {
    live: Set<Client<Socket>>;
    waiting: Set<Client<Socket>>;
    roomstate: string | undefined;
    replay: ReplayBuffer;
    /** 0 while overlays are connected. */
    emptySince: number;
}

const DEFAULT_NICK = "justinfan12345";
/**
 * Left on a socket the hub closed. Should the other side never answer the close, the runtime
 * keeps the socket, and a hub that is built again must not take it for an overlay.
 */
const CLOSED_BY_HUB = { closedByHub: true };

function closedByHub(value: unknown): boolean {
    return typeof value === "object" && value !== null && "closedByHub" in value;
}
const NICK = /^justinfan\d{1,12}$/;
const PHASES: readonly unknown[] = ["new", "waiting", "live"];

function readAttachment(socket: ClientSocket): ClientAttachment | undefined {
    const value = socket.deserializeAttachment() as Partial<ClientAttachment> | null;
    if (!value || typeof value !== "object") return undefined;
    const { channel, nick, phase, since } = value;
    if (typeof channel !== "string" || normaliseChannel(channel) !== channel) return undefined;
    if (typeof nick !== "string" || !NICK.test(nick)) return undefined;
    if (!PHASES.includes(phase) || typeof since !== "number") return undefined;
    return { channel, nick, phase: phase as ClientPhase, since };
}

function welcome(nick: string): string {
    return [
        `:tmi.twitch.tv 001 ${nick} :Welcome, GLHF!`,
        `:tmi.twitch.tv 002 ${nick} :Your host is tmi.twitch.tv`,
        `:tmi.twitch.tv 003 ${nick} :This server is rather new`,
        `:tmi.twitch.tv 004 ${nick} :-`,
        `:tmi.twitch.tv 375 ${nick} :-`,
        `:tmi.twitch.tv 372 ${nick} :You are in a maze of twisty passages, all alike.`,
        `:tmi.twitch.tv 376 ${nick} :>`,
    ].join("\r\n");
}

/**
 * One shard of the relay: overlays on one side, the pool of Twitch connections on the other.
 * To an overlay it looks like Twitch's own IRC endpoint for the one channel it asked for.
 *
 * Chat is held in memory only and is never logged, counted by content or stored.
 */
export class HubCore<Socket extends ClientSocket> {
    #config: HubConfig;
    #host: HubHost<Socket>;
    #pool: UpstreamPool;
    #clients = new Map<Socket, Client<Socket>>();
    #channels = new Map<string, HubChannel<Socket>>();
    #counters: Record<string, number> = {};
    /** The counters as the previous alarm reported them. */
    #reported: Record<string, number> = {};
    #instance = crypto.randomUUID().slice(0, 8);
    #bootedAt: number;
    /** 0 while no alarm is known to be scheduled. */
    #alarmAt = 0;
    #connects = new MinuteCounter();
    #lines = new MinuteCounter();
    #frames = new MinuteCounter();
    #paused: { reason: PauseReason; until: number } | undefined;

    constructor(config: HubConfig, host: HubHost<Socket>, runtime?: UpstreamRuntime) {
        this.#config = config;
        this.#host = host;
        this.#bootedAt = host.now();
        this.#pool = new UpstreamPool(
            config.upstream,
            {
                line: (channel, line, info) => this.#fanOut(channel, line, info),
                joined: (channel) => this.#greetWaiting(channel),
                lost: () => this.#count("channel-lost"),
                count: (name) => this.#count(`upstream-${name}`),
            },
            runtime,
        );
    }

    /**
     * Overlay sockets outlive the object's memory. Whatever built the object again, their
     * attachments say which channels have to be joined again. Never rejects: the object would
     * be reset, and the sockets with it.
     */
    async restore(): Promise<void> {
        const now = this.#host.now();
        await this.#recallPause(now);
        try {
            for (const socket of this.#host.sockets()) {
                // Whatever the runtime still holds when the hub wakes up inside its pause.
                if (this.#paused) this.#close(socket, CLOSE_OVERLOADED, "relay paused");
                else this.#adopt(socket, now);
            }
        } catch {
            this.#count("restore-failed");
        }
        if (this.#clients.size === 0) return;
        this.#count("restored");
        for (const channel of this.#channels.keys()) this.#pool.want(channel);
        try {
            // The constructor runs before the alarm that woke the object: setting the alarm
            // without looking would push that one into the future.
            const scheduled = await this.#host.getAlarm();
            if (scheduled === null) await this.#schedule(now + this.#config.watchdogMs);
            else this.#alarmAt = scheduled;
        } catch {
            this.#count("alarm-set-failed");
        }
    }

    /** Asked before the upgrade, so that a full hub costs the overlay one round trip. */
    refusal(channel: string): HubRefusal | undefined {
        if (this.#pauseAt(this.#host.now())) {
            this.#count("refused-paused");
            return "relay_paused";
        }
        if (this.#clients.size >= this.#config.maxClients) {
            this.#count("refused-clients");
            return "hub_full";
        }
        const room =
            this.#channels.has(channel) ||
            this.#channels.size < this.#config.maxChannels ||
            this.#longestIdle() !== undefined;
        if (room) return undefined;
        this.#count("refused-channels");
        return "channels_full";
    }

    /** The seconds after which an overlay that was refused may ask again. */
    retryAfter(): number {
        const now = this.#host.now();
        const pause = this.#pauseAt(now);
        return pause ? Math.max(1, Math.ceil((pause.until - now) / 1000)) : RETRY_AFTER_SECONDS;
    }

    async accepted(socket: Socket, channel: string): Promise<void> {
        const now = this.#host.now();
        const client: Client<Socket> = {
            socket,
            channel,
            nick: DEFAULT_NICK,
            phase: "new",
            since: now,
            heardAt: now,
            frames: 0,
        };
        this.#clients.set(socket, client);
        this.#save(client);
        this.#count("client-accepted");
        this.#connects.add(now);
        // Looked at with every connection and not only by the alarm, so that a flood ends
        // with the connection that exceeds a threshold.
        const excess = this.#excess(now, false);
        if (excess) {
            await this.#pause(excess, now);
            return;
        }
        await this.#arm(now + this.#config.joinDeadlineMs);
    }

    async message(socket: Socket, data: string | ArrayBuffer): Promise<void> {
        const now = this.#host.now();
        // Every frame is a billed event of the object, from whichever socket it comes.
        this.#frames.add(now);
        const paused = this.#pauseAt(now);
        if (paused) {
            // Closed with the pause, and still talking: the close was not answered.
            this.#host.reset();
            return;
        }
        const frames = this.#frames.total(now);
        if (this.#config.pauseFramesPerMinute > 0 && frames > this.#config.pauseFramesPerMinute) {
            const threshold = this.#config.pauseFramesPerMinute;
            await this.#pause({ reason: "frames", measured: frames, threshold }, now);
            return;
        }
        const client = this.#clients.get(socket);
        if (!client) {
            // Its attachment was unreadable when the object was built again.
            this.#count("client-unknown");
            this.#close(socket, CLOSE_INTERNAL, "connection state lost");
            return;
        }
        if (typeof data !== "string") {
            this.#count("client-frame-refused");
            await this.#drop(client, CLOSE_UNSUPPORTED, "text frames only");
            return;
        }
        if (data.length > this.#config.maxFrameLength) {
            this.#count("client-frame-refused");
            await this.#drop(client, CLOSE_TOO_BIG, "frame too long");
            return;
        }
        if (++client.frames > this.#config.maxFrames) {
            this.#count("client-frame-refused");
            await this.#drop(client, CLOSE_POLICY, "too many frames");
            return;
        }
        client.heardAt = now;
        try {
            for (const line of data.split(/\r?\n/)) {
                if (line) await this.#command(client, line);
                if (!this.#clients.has(socket)) return;
            }
        } catch {
            this.#count("client-failed");
            await this.#drop(client, CLOSE_INTERNAL, "internal error");
        }
    }

    /** The socket closed or broke; the runtime does not deliver to it any more. */
    async closed(socket: Socket): Promise<void> {
        const client = this.#clients.get(socket);
        if (!client) return;
        this.#count("client-closed");
        const due = this.#detach(client);
        if (due !== undefined) await this.#arm(due);
    }

    async alarm(): Promise<void> {
        const now = this.#host.now();
        this.#alarmAt = 0;
        // Set before the pause began. A paused hub has nothing to look after and sets none.
        if (this.#pauseAt(now)) return;
        let idle = false;
        try {
            this.#closeOverdue(now);
            this.#releaseExpired(now);
            const excess = this.#excess(now, true);
            if (excess) await this.#pause(excess, now);
            idle = this.#clients.size === 0 && this.#channels.size === 0;
            if (idle) this.#pool.shutdown();
            else this.#pool.pump(now);
            this.#host.report(this.#tick());
        } catch {
            // A failed pass must not end the watchdog; alarms are only retried six times.
            this.#count("alarm-failed");
        }
        // An idle hub does not set the alarm again: without upstream connections, timers and
        // an alarm the object leaves memory and stops costing duration.
        if (!idle) await this.#schedule(this.#nextDeadline(now));
    }

    status(shard: number | null): HubStatus {
        const now = this.#host.now();
        const pause = this.#pauseAt(now);
        const config = this.#config;
        let pendingClients = 0;
        let idleChannels = 0;
        let replayLines = 0;
        for (const client of this.#clients.values()) if (client.phase === "new") pendingClients++;
        for (const channel of this.#channels.values()) {
            replayLines += channel.replay.size;
            if (channel.emptySince > 0) idleChannels++;
        }
        return {
            shard,
            instance: this.#instance,
            uptimeMs: now - this.#bootedAt,
            sockets: this.#host.sockets().length,
            clients: this.#clients.size,
            pendingClients,
            channels: this.#channels.size,
            idleChannels,
            replayLines,
            alarmInMs: this.#alarmAt === 0 ? null : this.#alarmAt - now,
            limits: { clients: config.maxClients, channels: config.maxChannels },
            pause: pause ? { reason: pause.reason, remainingMs: pause.until - now } : null,
            thresholds: {
                clients: config.pauseClients,
                channels: config.pauseChannels,
                connectsPerMinute: config.pauseConnectsPerMinute,
                linesPerMinute: config.pauseLinesPerMinute,
                framesPerMinute: config.pauseFramesPerMinute,
                pauseMs: config.pauseMs,
            },
            upstream: this.#pool.status(now),
            counters: { ...this.#counters },
        };
    }

    /**
     * The first threshold that is exceeded. Chat lines are only looked at by the alarm, frames
     * by every frame.
     */
    #excess(now: number, lines: boolean): PauseStart | undefined {
        const config = this.#config;
        const measured: [PauseReason, number, number][] = [
            ["clients", this.#clients.size, config.pauseClients],
            ["channels", this.#channels.size, config.pauseChannels],
            ["connects", this.#connects.total(now), config.pauseConnectsPerMinute],
        ];
        if (lines) measured.push(["lines", this.#lines.total(now), config.pauseLinesPerMinute]);
        for (const [reason, value, threshold] of measured) {
            if (threshold > 0 && value > threshold) return { reason, measured: value, threshold };
        }
        return undefined;
    }

    /**
     * Drops everything the hub holds, so that it costs nothing until the pause is over. An
     * overlay takes the close for a relay that failed and ends up on its direct connection.
     */
    async #pause(excess: PauseStart, now: number): Promise<void> {
        const until = now + this.#config.pauseMs;
        this.#paused = { reason: excess.reason, until };
        for (const socket of this.#clients.keys()) {
            this.#close(socket, CLOSE_OVERLOADED, "relay paused");
        }
        this.#clients.clear();
        this.#channels.clear();
        this.#pool.shutdown();
        this.#count(`paused-${excess.reason}`);
        this.#host.paused(excess);
        try {
            await this.#host.storePause(until, excess.reason);
        } catch {
            // The pause holds all the same, for as long as the hub stays in memory.
            this.#count("pause-storage-failed");
        }
    }

    /**
     * The pause that is in force. A paused hub sets no alarm, so the end of its pause is
     * noticed by whoever asks first afterwards.
     */
    #pauseAt(now: number): { reason: PauseReason; until: number } | undefined {
        const pause = this.#paused;
        if (!pause || now < pause.until) return pause;
        this.#paused = undefined;
        this.#resumed(pause.reason);
        this.#forgetPause();
        return undefined;
    }

    #resumed(reason: PauseReason): void {
        this.#count("resumed");
        this.#host.resumed(reason);
    }

    async #forgetPause(): Promise<void> {
        try {
            await this.#host.forgetPause();
        } catch {
            // What stays behind names a time that has passed, and goes with the next attempt.
            this.#count("pause-storage-failed");
        }
    }

    /** Never rejects, like `restore()`: a hub that cannot read its storage is an open one. */
    async #recallPause(now: number): Promise<void> {
        try {
            const { until, reason } = await this.#host.storedPause();
            if (until === undefined && reason === undefined) return;
            const pause = typeof until === "number" && PAUSE_REASONS.includes(reason);
            if (pause && until > now) {
                // Stored under a longer setting, or by a clock that was ahead: the pause ends
                // when one that began now would, and the storage says so from now on.
                const capped = Math.min(until, now + this.#config.pauseMs);
                this.#paused = { reason: reason as PauseReason, until: capped };
                if (capped < until) await this.#host.storePause(capped, reason as PauseReason);
                return;
            }
            // Over while the hub was out of memory, or nothing the hub has written.
            if (pause) this.#resumed(reason as PauseReason);
            await this.#host.forgetPause();
        } catch {
            this.#count("pause-storage-failed");
        }
    }

    #adopt(socket: Socket, now: number): void {
        if (closedByHub(socket.deserializeAttachment())) {
            this.#count("client-phantom");
            return;
        }
        const attachment = readAttachment(socket);
        if (!attachment) {
            this.#count("client-unknown");
            this.#close(socket, CLOSE_INTERNAL, "connection state lost");
            return;
        }
        const client: Client<Socket> = { ...attachment, socket, heardAt: now, frames: 0 };
        this.#clients.set(socket, client);
        if (client.phase === "new") return;
        const channel = this.#channel(client.channel);
        (client.phase === "live" ? channel.live : channel.waiting).add(client);
    }

    async #command(client: Client<Socket>, line: string): Promise<void> {
        const space = line.indexOf(" ");
        const command = (space === -1 ? line : line.slice(0, space)).toUpperCase();
        const rest = space === -1 ? "" : line.slice(space + 1);
        switch (command) {
            case "CAP":
                if (rest.startsWith("REQ ")) {
                    this.#send(client, `:tmi.twitch.tv CAP * ACK ${rest.slice(4)}`);
                }
                return;
            case "NICK":
                // Echoed back in the JOIN line, so only the anonymous form is accepted.
                client.nick = NICK.test(rest) ? rest : DEFAULT_NICK;
                this.#save(client);
                this.#send(client, welcome(client.nick));
                return;
            case "JOIN":
                await this.#join(client, rest);
                return;
            case "PING":
                // Only a keep-alive other than the overlay's arrives here.
                this.#send(client, `:tmi.twitch.tv PONG tmi.twitch.tv ${rest}`);
                return;
            case "PART":
            case "QUIT":
                await this.#drop(client, CLOSE_NORMAL, "bye");
                return;
        }
    }

    async #join(client: Client<Socket>, target: string): Promise<void> {
        if (client.phase !== "new") return;
        if (normaliseChannel(target) !== client.channel) {
            // The Worker routed this socket by its channel; another one belongs to another hub.
            this.#count("client-wrong-channel");
            await this.#drop(client, CLOSE_POLICY, "channel does not match the connection");
            return;
        }
        if (!this.#channels.has(client.channel) && !this.#makeRoom()) {
            this.#count("refused-channels");
            await this.#drop(client, CLOSE_OVERLOADED, "too many channels");
            return;
        }
        const channel = this.#channel(client.channel);
        channel.emptySince = 0;
        channel.waiting.add(client);
        client.phase = "waiting";
        this.#save(client);
        this.#count("client-joined");
        this.#pool.want(client.channel);
        if (this.#pool.isJoined(client.channel)) this.#greet(client, channel);
        await this.#arm(this.#host.now() + this.#config.watchdogMs);
    }

    #channel(name: string): HubChannel<Socket> {
        let channel = this.#channels.get(name);
        if (!channel) {
            channel = {
                live: new Set(),
                waiting: new Set(),
                roomstate: undefined,
                replay: new ReplayBuffer(this.#config.replayLines),
                emptySince: 0,
            };
            this.#channels.set(name, channel);
        }
        return channel;
    }

    /** At the limit a channel nobody watches gives way to one somebody wants to watch. */
    #makeRoom(): boolean {
        if (this.#channels.size < this.#config.maxChannels) return true;
        const idle = this.#longestIdle();
        if (idle === undefined) return false;
        this.#pool.release(idle);
        this.#channels.delete(idle);
        this.#count("channel-evicted");
        return true;
    }

    #longestIdle(): string | undefined {
        let name: string | undefined;
        let since = Number.POSITIVE_INFINITY;
        for (const [candidate, channel] of this.#channels) {
            if (channel.emptySince === 0 || channel.emptySince >= since) continue;
            name = candidate;
            since = channel.emptySince;
        }
        return name;
    }

    #greetWaiting(name: string): void {
        const channel = this.#channels.get(name);
        if (!channel) return;
        for (const client of [...channel.waiting]) this.#greet(client, channel);
    }

    /** JOIN echo, room state and replay in one frame, so nothing can slip in between. */
    #greet(client: Client<Socket>, channel: HubChannel<Socket>): void {
        const nick = client.nick;
        const lines = [`:${nick}!${nick}@${nick}.tmi.twitch.tv JOIN #${client.channel}`];
        if (channel.roomstate) lines.push(channel.roomstate);
        lines.push(...channel.replay.lines());
        channel.waiting.delete(client);
        channel.live.add(client);
        client.phase = "live";
        this.#save(client);
        this.#send(client, lines.join("\r\n"));
    }

    #fanOut(name: string, line: string, info: IrcLineInfo): void {
        const now = this.#host.now();
        this.#lines.add(now);
        const channel = this.#channels.get(name);
        if (!channel) return;
        if (info.command === "ROOMSTATE") {
            channel.roomstate = mergeRoomstate(channel.roomstate, line);
        }
        channel.replay.observe(line, info);
        for (const client of channel.live) this.#send(client, line);
        this.#guardWatchdog(now);
    }

    /**
     * Without the alarm the runtime removes the object from memory while overlays stay
     * connected and keep getting their keep-alive answered: chat would stop without anyone
     * noticing. Should the alarm ever go missing, the next line of chat sets it again.
     */
    #guardWatchdog(now: number): void {
        if (this.#alarmAt !== 0 && now < this.#alarmAt + this.#config.watchdogMs) return;
        this.#alarmAt = 0;
        this.#count("watchdog-rearmed");
        this.#arm(now + this.#config.watchdogMs);
    }

    #closeOverdue(now: number): void {
        for (const client of [...this.#clients.values()]) {
            if (client.phase === "new") {
                if (now - client.since < this.#config.joinDeadlineMs) continue;
                this.#count("client-never-joined");
                this.#detach(client);
                this.#close(client.socket, CLOSE_POLICY, "no JOIN");
            } else if (this.#stale(client, now)) {
                this.#count("client-stale");
                this.#detach(client);
                this.#close(client.socket, CLOSE_GOING_AWAY, "no keep-alive");
            }
        }
    }

    #stale(client: Client<Socket>, now: number): boolean {
        if (now - client.heardAt < this.#config.staleClientMs) return false;
        // Remembered, so the runtime is asked once per period and client, not once per alarm.
        client.heardAt = Math.max(client.heardAt, this.#host.keptAliveAt(client.socket) ?? 0);
        return now - client.heardAt >= this.#config.staleClientMs;
    }

    #releaseExpired(now: number): void {
        for (const [name, channel] of this.#channels) {
            if (channel.emptySince === 0) continue;
            if (now - channel.emptySince < this.#config.graceMs) continue;
            this.#pool.release(name);
            this.#channels.delete(name);
        }
    }

    #nextDeadline(now: number): number {
        const { watchdogMs, graceMs, joinDeadlineMs } = this.#config;
        let at = now + watchdogMs;
        for (const channel of this.#channels.values()) {
            if (channel.emptySince > 0) at = Math.min(at, channel.emptySince + graceMs);
        }
        for (const client of this.#clients.values()) {
            if (client.phase === "new") at = Math.min(at, client.since + joinDeadlineMs);
        }
        return Math.max(at, now + 1000);
    }

    /** For all but the alarm itself, whose failure the runtime answers by running it again. */
    async #arm(at: number): Promise<void> {
        try {
            await this.#schedule(at);
        } catch {
            this.#count("alarm-set-failed");
        }
    }

    async #schedule(at: number): Promise<void> {
        if (this.#alarmAt !== 0 && this.#alarmAt <= at) return;
        const previous = this.#alarmAt;
        this.#alarmAt = at;
        try {
            await this.#host.setAlarm(at);
        } catch (error) {
            this.#alarmAt = previous;
            throw error;
        }
    }

    /** Forgets the client. Returns when its channel is due for release, if it is empty now. */
    #detach(client: Client<Socket>): number | undefined {
        this.#clients.delete(client.socket);
        const channel = this.#channels.get(client.channel);
        if (!channel) return undefined;
        const member = channel.live.delete(client) || channel.waiting.delete(client);
        if (!member || channel.live.size + channel.waiting.size > 0) return undefined;
        channel.emptySince = this.#host.now();
        return channel.emptySince + this.#config.graceMs;
    }

    async #drop(client: Client<Socket>, code: number, reason: string): Promise<void> {
        const due = this.#detach(client);
        this.#close(client.socket, code, reason);
        if (due !== undefined) await this.#arm(due);
    }

    #close(socket: Socket, code: number, reason: string): void {
        try {
            socket.serializeAttachment(CLOSED_BY_HUB);
        } catch {
            // The socket is gone already.
        }
        try {
            socket.close(code, reason);
        } catch {
            // Closed by the other side in the meantime.
        }
    }

    #save(client: Client<Socket>): void {
        const attachment: ClientAttachment = {
            channel: client.channel,
            nick: client.nick,
            phase: client.phase,
            since: client.since,
        };
        try {
            client.socket.serializeAttachment(attachment);
        } catch {
            // The socket is gone; its close event removes the client.
            this.#count("client-save-failed");
        }
    }

    #send(client: Client<Socket>, data: string): void {
        try {
            client.socket.send(data);
        } catch {
            // The socket closed under us; its close event removes the client.
            this.#count("client-send-failed");
        }
    }

    #count(name: string): void {
        this.#counters[name] = (this.#counters[name] ?? 0) + 1;
    }

    #tick(): HubTick {
        const since = (name: string) => (this.#counters[name] ?? 0) - (this.#reported[name] ?? 0);
        const upstream = this.#pool.status(this.#host.now());
        const tick: HubTick = {
            clients: this.#clients.size,
            channels: this.#channels.size,
            upstreamConnections: upstream.connections.length,
            joinedChannels: upstream.joined,
            lines: since("upstream-line"),
            accepted: since("client-accepted"),
            refused: since("refused-clients") + since("refused-channels") + since("refused-paused"),
            upstreamFailures: since("upstream-connect-failed"),
        };
        this.#reported = { ...this.#counters };
        return tick;
    }
}
