import type { IrcLineInfo } from "./irc";
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
/** The hub is full. */
export const CLOSE_OVERLOADED = 1013;

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
    /** An overlay sends its JOIN right after connecting; a socket that does not is not one. */
    joinDeadlineMs: number;
    /**
     * An overlay sends its keep-alive every minute. A socket that stayed silent this long has
     * lost its overlay without the network noticing.
     */
    staleClientMs: number;
}

export const HUB_DEFAULTS: Omit<HubConfig, "upstream"> = {
    replayLines: 50,
    graceMs: 60_000,
    watchdogMs: 30_000,
    maxClients: 5000,
    maxChannels: 1000,
    maxFrameLength: 1024,
    joinDeadlineMs: 30_000,
    staleClientMs: 600_000,
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

/** Everything the hub takes from the Durable Object around it. */
export interface HubHost<Socket extends ClientSocket> {
    now(): number;
    /** Every client socket the runtime holds for the object. */
    sockets(): Socket[];
    /** When the runtime last answered the socket's keep-alive, if it ever did. */
    keptAliveAt(socket: Socket): number | undefined;
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
    report(tick: HubTick): void;
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
    upstream: UpstreamStatus;
    counters: Record<string, number>;
}

export type HubRefusal = "hub_full" | "channels_full";

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
        try {
            for (const socket of this.#host.sockets()) this.#adopt(socket, now);
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

    async accepted(socket: Socket, channel: string): Promise<void> {
        const now = this.#host.now();
        const client: Client<Socket> = {
            socket,
            channel,
            nick: DEFAULT_NICK,
            phase: "new",
            since: now,
            heardAt: now,
        };
        this.#clients.set(socket, client);
        this.#save(client);
        this.#count("client-accepted");
        await this.#arm(now + this.#config.joinDeadlineMs);
    }

    async message(socket: Socket, data: string | ArrayBuffer): Promise<void> {
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
        client.heardAt = this.#host.now();
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
        let idle = false;
        try {
            this.#closeOverdue(now);
            this.#releaseExpired(now);
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
            limits: { clients: this.#config.maxClients, channels: this.#config.maxChannels },
            upstream: this.#pool.status(now),
            counters: { ...this.#counters },
        };
    }

    #adopt(socket: Socket, now: number): void {
        const attachment = readAttachment(socket);
        if (!attachment) {
            this.#count("client-unknown");
            this.#close(socket, CLOSE_INTERNAL, "connection state lost");
            return;
        }
        const client: Client<Socket> = { ...attachment, socket, heardAt: now };
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
        const channel = this.#channels.get(name);
        if (!channel) return;
        if (info.command === "ROOMSTATE") {
            channel.roomstate = mergeRoomstate(channel.roomstate, line);
        }
        channel.replay.observe(line, info);
        for (const client of channel.live) this.#send(client, line);
        this.#guardWatchdog();
    }

    /**
     * Without the alarm the runtime removes the object from memory while overlays stay
     * connected and keep getting their keep-alive answered: chat would stop without anyone
     * noticing. Should the alarm ever go missing, the next line of chat sets it again.
     */
    #guardWatchdog(): void {
        const now = this.#host.now();
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
            refused: since("refused-clients") + since("refused-channels"),
            upstreamFailures: since("upstream-connect-failed"),
        };
        this.#reported = { ...this.#counters };
        return tick;
    }
}
