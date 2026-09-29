import type { ClientSocket, HubHost, HubTick } from "../../../src/worker/relay/core";
import type {
    UpstreamCounter,
    UpstreamEvents,
    UpstreamRuntime,
    UpstreamSocket,
    UpstreamSocketEvents,
} from "../../../src/worker/relay/upstream";
import { joinEcho, partEcho } from "./lines";

interface Timer {
    next: number;
    intervalMs: number;
    run: () => void;
}

/** A clock that moves only when the test says so, with the timers that hang on it. */
export class FakeClock {
    // A time of day as the runtime reports it; the code under test uses 0 for "never".
    now = 1_790_000_000_000;
    #timers = new Set<Timer>();

    get timers(): number {
        return this.#timers.size;
    }

    every(intervalMs: number, run: () => void): () => void {
        const timer: Timer = { next: this.now + intervalMs, intervalMs, run };
        this.#timers.add(timer);
        return () => {
            this.#timers.delete(timer);
        };
    }

    /** Moves time forward and runs every timer that falls due on the way, in order. */
    advance(ms: number): void {
        const end = this.now + ms;
        for (;;) {
            let due: Timer | undefined;
            for (const timer of this.#timers) {
                if (timer.next <= end && (!due || timer.next < due.next)) due = timer;
            }
            if (!due) break;
            this.now = due.next;
            due.next += due.intervalMs;
            due.run();
        }
        this.now = end;
    }
}

/** One connection to Twitch, seen from Twitch's side. */
export class FakeUpstreamSocket implements UpstreamSocket {
    readonly url: string;
    readonly openedAt: number;
    /** Everything the pool sent, with the time it was sent. */
    readonly log: { at: number; line: string }[] = [];
    nick = "";
    /** Closed by the pool. */
    closed = false;
    /** Makes `send` throw, as it does on a socket that broke. */
    broken = false;
    /** Twitch answers a PING at once, unless the connection has gone silent. */
    silent = false;
    #events: UpstreamSocketEvents;
    #clock: FakeClock;

    constructor(url: string, events: UpstreamSocketEvents, clock: FakeClock) {
        this.url = url;
        this.openedAt = clock.now;
        this.#events = events;
        this.#clock = clock;
    }

    get sent(): string[] {
        return this.log.map((entry) => entry.line);
    }

    /** The channels the pool asked to join here, in order. */
    get joins(): string[] {
        return this.#channels("JOIN");
    }

    get parts(): string[] {
        return this.#channels("PART");
    }

    #channels(command: string): string[] {
        const prefix = `${command} #`;
        return this.sent
            .filter((line) => line.startsWith(prefix))
            .map((line) => line.slice(prefix.length));
    }

    send(data: string): void {
        if (this.broken || this.closed) throw new Error("socket is not open");
        this.log.push({ at: this.#clock.now, line: data });
        if (data.startsWith("NICK ")) this.nick = data.slice(5);
        if (data.startsWith("PING ") && !this.silent) {
            this.receive(`:tmi.twitch.tv PONG tmi.twitch.tv ${data.slice(5)}`);
        }
    }

    close(): void {
        this.closed = true;
    }

    open(): void {
        this.#events.open();
    }

    /** One frame with the given lines, as Twitch frames them. */
    receive(...lines: string[]): void {
        this.#events.frame(lines.map((line) => `${line}\r\n`).join(""));
    }

    welcome(): void {
        this.receive(
            `:tmi.twitch.tv 001 ${this.nick} :Welcome, GLHF!`,
            `:tmi.twitch.tv 002 ${this.nick} :Your host is tmi.twitch.tv`,
            `:tmi.twitch.tv 376 ${this.nick} :>`,
        );
    }

    login(): void {
        this.open();
        this.welcome();
    }

    echoJoin(...channels: string[]): void {
        for (const channel of channels) this.receive(joinEcho(this.nick, channel));
    }

    echoPart(...channels: string[]): void {
        for (const channel of channels) this.receive(partEcho(this.nick, channel));
    }

    /** Confirms every JOIN that has been sent and not confirmed yet. */
    confirmJoins(): void {
        const confirmed = this.#confirmed;
        this.#confirmed = this.joins.length;
        this.echoJoin(...this.joins.slice(confirmed));
    }

    #confirmed = 0;

    /** The connection is lost. */
    drop(): void {
        this.#events.closed();
    }
}

export class FakeTwitch implements UpstreamRuntime {
    readonly clock: FakeClock;
    readonly sockets: FakeUpstreamSocket[] = [];
    /** Makes `connect` throw. */
    unreachable = false;
    /** What `random` returns; 0.5 makes the jitter of a backoff a factor of one. */
    chance = 0.5;

    constructor(clock = new FakeClock()) {
        this.clock = clock;
    }

    /** The connections the pool has not closed. */
    get open(): FakeUpstreamSocket[] {
        return this.sockets.filter((socket) => !socket.closed);
    }

    get last(): FakeUpstreamSocket {
        const socket = this.sockets.at(-1);
        if (!socket) throw new Error("the pool has not connected");
        return socket;
    }

    now(): number {
        return this.clock.now;
    }

    random(): number {
        return this.chance;
    }

    connect(url: string, events: UpstreamSocketEvents): UpstreamSocket {
        if (this.unreachable) throw new Error("connection refused");
        const socket = new FakeUpstreamSocket(url, events, this.clock);
        this.sockets.push(socket);
        return socket;
    }

    every(intervalMs: number, run: () => void): () => void {
        return this.clock.every(intervalMs, run);
    }
}

/** Records what the pool reports. */
export class RecordedEvents {
    /** Lines and JOIN confirmations in the order they were reported. */
    readonly log: string[] = [];
    readonly lines: { channel: string; line: string }[] = [];
    readonly joined: string[] = [];
    readonly lost: string[] = [];
    readonly counters: Partial<Record<UpstreamCounter, number>> = {};

    readonly handlers: UpstreamEvents = {
        line: (channel, line) => {
            this.lines.push({ channel, line });
            this.log.push(`line ${channel}`);
        },
        joined: (channel) => {
            this.joined.push(channel);
            this.log.push(`joined ${channel}`);
        },
        lost: (channel) => {
            this.lost.push(channel);
        },
        count: (name) => {
            this.counters[name] = (this.counters[name] ?? 0) + 1;
        },
    };

    /** The lines reported for one channel. */
    of(channel: string): string[] {
        return this.lines.filter((entry) => entry.channel === channel).map((entry) => entry.line);
    }
}

/** The hub's end of an overlay's socket, as the runtime hands it to the Durable Object. */
export class FakeClientSocket implements ClientSocket {
    readonly frames: string[] = [];
    closeCode: number | undefined;
    closeReason: string | undefined;
    /** Survives the object, like the attachment of a hibernatable socket. */
    attachment: unknown = null;

    /** Every line received, whatever frame it came in. */
    get lines(): string[] {
        return this.frames.flatMap((frame) => frame.split("\r\n"));
    }

    send(data: string): void {
        if (this.closeCode !== undefined) throw new Error("socket is closed");
        this.frames.push(data);
    }

    close(code?: number, reason?: string): void {
        if (this.closeCode !== undefined) throw new Error("socket is closed");
        this.closeCode = code ?? 1005;
        this.closeReason = reason;
    }

    serializeAttachment(value: unknown): void {
        this.attachment = structuredClone(value);
    }

    deserializeAttachment(): unknown {
        return structuredClone(this.attachment);
    }
}

/** What the Durable Object gives the hub: sockets, the alarm and a place for counters. */
export class FakeHost implements HubHost<FakeClientSocket> {
    readonly clock: FakeClock;
    /** Every socket that was ever accepted. */
    readonly accepted: FakeClientSocket[] = [];
    readonly keepAlives = new Map<FakeClientSocket, number>();
    readonly ticks: HubTick[] = [];
    alarmAt: number | null = null;
    /** Makes the storage refuse the alarm. */
    storageDown = false;

    constructor(clock: FakeClock) {
        this.clock = clock;
    }

    now(): number {
        return this.clock.now;
    }

    sockets(): FakeClientSocket[] {
        return this.accepted.filter((socket) => socket.closeCode === undefined);
    }

    keptAliveAt(socket: FakeClientSocket): number | undefined {
        return this.keepAlives.get(socket);
    }

    async getAlarm(): Promise<number | null> {
        if (this.storageDown) throw new Error("storage is down");
        return this.alarmAt;
    }

    async setAlarm(at: number): Promise<void> {
        if (this.storageDown) throw new Error("storage is down");
        this.alarmAt = at;
    }

    report(tick: HubTick): void {
        this.ticks.push(tick);
    }
}
