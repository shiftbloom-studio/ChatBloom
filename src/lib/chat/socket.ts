export interface ReconnectingSocketOptions {
    /** Evaluated on every (re)connect, so a socket whose URL encodes its topics can change them. */
    url: () => string;
    onOpen?: (socket: ReconnectingSocket) => void;
    onMessage: (data: string, socket: ReconnectingSocket) => void;
    /**
     * Called when the connection closed or went silent, and decides how soon the next attempt
     * follows. Without it a closed connection is retried after the backoff and a silent one
     * at once.
     */
    onLost?: () => "now" | "backoff";
    /**
     * For protocols that tell by themselves when a connection works: the backoff starts over
     * only when `settle()` is called, and not once the socket has stayed open for a while.
     */
    settleManually?: boolean;
    /** Reconnect when nothing has been received for this long. */
    idleTimeoutMs?: number;
    label: string;
}

const MAX_BACKOFF_MS = 60_000;

/**
 * How long a socket has to stay open before it counts as a working connection. Servers accept a
 * socket only to close it again (7TV ends the stream right after its hello when it rejects a
 * subscription, a proxy may drop the upgraded socket at once), and counting every open socket
 * as working would retry those about once a second for as long as they keep doing it.
 */
const STABLE_AFTER_MS = 10_000;

/** A WebSocket that reconnects with jittered exponential backoff until stopped. */
export class ReconnectingSocket {
    #options: ReconnectingSocketOptions;
    #ws: WebSocket | undefined;
    #attempt = 0;
    #stopped = true;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    #idleTimer: ReturnType<typeof setTimeout> | undefined;
    #stableTimer: ReturnType<typeof setTimeout> | undefined;
    #idleTimeoutMs: number | undefined;

    constructor(options: ReconnectingSocketOptions) {
        this.#options = options;
        this.#idleTimeoutMs = options.idleTimeoutMs;
    }

    get open(): boolean {
        return this.#ws?.readyState === WebSocket.OPEN;
    }

    start(): void {
        if (!this.#stopped) return;
        this.#stopped = false;
        this.#connect();
    }

    stop(): void {
        this.#stopped = true;
        clearTimeout(this.#retryTimer);
        this.#teardown();
    }

    send(data: string): void {
        if (this.open) this.#ws?.send(data);
    }

    /** The connection works: the next retry starts the backoff over. */
    settle(): void {
        this.#attempt = 0;
    }

    /** Drops the connection and connects again, immediately or after backoff. */
    reconnect(immediate = false): void {
        if (this.#stopped) return;
        this.#teardown();
        clearTimeout(this.#retryTimer);
        if (immediate) {
            this.#connect();
            return;
        }
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.#attempt) * (0.5 + Math.random());
        this.#attempt++;
        this.#retryTimer = setTimeout(() => this.#connect(), delay);
    }

    /**
     * Pushes the idle deadline out; call on any sign of life, e.g. a heartbeat. A timeout given
     * here applies from now on, for protocols whose server names the heartbeat interval.
     */
    keepAlive(timeoutMs = this.#idleTimeoutMs): void {
        this.#idleTimeoutMs = timeoutMs;
        clearTimeout(this.#idleTimer);
        if (timeoutMs === undefined || this.#stopped) return;
        this.#idleTimer = setTimeout(() => {
            console.warn(`[${this.#options.label}] no traffic for ${timeoutMs}ms, reconnecting`);
            this.#lost(true);
        }, timeoutMs);
    }

    #connect(): void {
        if (this.#stopped) return;
        const ws = new WebSocket(this.#options.url());
        this.#ws = ws;
        ws.onopen = () => {
            if (!this.#options.settleManually) {
                this.#stableTimer = setTimeout(() => this.settle(), STABLE_AFTER_MS);
            }
            this.keepAlive();
            this.#options.onOpen?.(this);
        };
        ws.onmessage = (event) => {
            this.keepAlive();
            if (typeof event.data === "string") this.#options.onMessage(event.data, this);
        };
        ws.onclose = () => {
            if (this.#ws !== ws) return;
            this.#lost(false);
        };
    }

    #lost(silent: boolean): void {
        this.#teardown();
        const retry = this.#options.onLost?.() ?? (silent ? "now" : "backoff");
        this.reconnect(retry === "now");
    }

    #teardown(): void {
        // Both timers belong to the connection: left running, one would report the silence of
        // a connection that is already gone, the other would credit its uptime to the next.
        clearTimeout(this.#idleTimer);
        clearTimeout(this.#stableTimer);
        const ws = this.#ws;
        this.#ws = undefined;
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close();
    }
}
