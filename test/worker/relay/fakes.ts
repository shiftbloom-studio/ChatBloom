import type { UpstreamRuntime, UpstreamSocketEvents } from "../../../src/worker/relay/upstream";
import { joinEcho } from "./lines";

/** Twitch and the runtime around the pool: a clock that moves only when the test says so. */
export class FakeTwitch implements UpstreamRuntime {
    // A time of day as the runtime reports it; the code under test uses 0 for "never".
    time = 1_790_000_000_000;
    readonly sockets: FakeUpstreamSocket[] = [];
    #timers = new Set<{ next: number; intervalMs: number; run: () => void }>();

    get last(): FakeUpstreamSocket {
        return this.sockets.at(-1) as FakeUpstreamSocket;
    }

    now = () => this.time;
    /** Makes the jitter of every backoff a factor of one. */
    random = () => 0.5;

    connect(_url: string, events: UpstreamSocketEvents): FakeUpstreamSocket {
        this.sockets.push(new FakeUpstreamSocket(events, this));
        return this.last;
    }

    every(intervalMs: number, run: () => void): () => void {
        const timer = { next: this.time + intervalMs, intervalMs, run };
        this.#timers.add(timer);
        return () => this.#timers.delete(timer);
    }

    /** Moves time forward and runs every timer that falls due on the way, in order. */
    advance(ms: number): void {
        const end = this.time + ms;
        for (;;) {
            const due = [...this.#timers].filter((timer) => timer.next <= end);
            const next = due.sort((a, b) => a.next - b.next)[0];
            if (!next) break;
            this.time = next.next;
            next.next += next.intervalMs;
            next.run();
        }
        this.time = end;
    }
}

/** One connection to Twitch, seen from Twitch's side. */
export class FakeUpstreamSocket {
    /** Everything the pool sent, with the time it was sent. */
    readonly log: { at: number; line: string }[] = [];
    readonly events: UpstreamSocketEvents;
    nick = "";
    closed = false;
    /** Twitch answers a PING at once, unless the connection has gone silent. */
    silent = false;
    #confirmed = 0;
    #twitch: FakeTwitch;

    constructor(events: UpstreamSocketEvents, twitch: FakeTwitch) {
        this.events = events;
        this.#twitch = twitch;
    }

    /** The channels the pool asked to join (or to leave) here, in order. */
    channels(command = "JOIN"): string[] {
        const lines = this.log.map((entry) => entry.line);
        return lines.filter((line) => line.startsWith(`${command} #`)).map((line) => line.slice(6));
    }

    send(data: string): void {
        if (this.closed) throw new Error("socket is not open");
        this.log.push({ at: this.#twitch.time, line: data });
        if (data.startsWith("NICK ")) this.nick = data.slice(5);
        if (data.startsWith("PING ") && !this.silent) {
            this.receive(`:tmi.twitch.tv PONG tmi.twitch.tv ${data.slice(5)}`);
        }
    }

    close(): void {
        this.closed = true;
    }

    /** One frame with the given lines, as Twitch frames them. */
    receive(...lines: string[]): void {
        this.events.frame(lines.map((line) => `${line}\r\n`).join(""));
    }

    login(): void {
        this.events.open();
        this.receive(`:tmi.twitch.tv 001 ${this.nick} :Welcome, GLHF!`);
    }

    /** Confirms every JOIN that has been sent and not confirmed yet. */
    confirmJoins(): void {
        const unconfirmed = this.channels().slice(this.#confirmed);
        this.#confirmed += unconfirmed.length;
        for (const channel of unconfirmed) this.receive(joinEcho(this.nick, channel));
    }
}
