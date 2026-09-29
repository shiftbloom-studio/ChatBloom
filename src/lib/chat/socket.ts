export interface ReconnectingSocketOptions {
    /** Evaluated on every (re)connect, so a socket whose URL encodes its topics can change them. */
    url: () => string;
    onOpen?: (socket: ReconnectingSocket) => void;
    onMessage: (data: string, socket: ReconnectingSocket) => void;
    onClose?: () => void;
    /** Reconnect when nothing has been received for this long. */
    idleTimeoutMs?: number;
    label: string;
}

const MAX_BACKOFF_MS = 60_000;

/** A WebSocket that reconnects with jittered exponential backoff until stopped. */
export class ReconnectingSocket {
    #options: ReconnectingSocketOptions;
    #ws: WebSocket | undefined;
    #attempt = 0;
    #stopped = true;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    #idleTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: ReconnectingSocketOptions) {
        this.#options = options;
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
        clearTimeout(this.#idleTimer);
        this.#teardown();
    }

    send(data: string): void {
        if (this.open) this.#ws?.send(data);
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

    /** Pushes the idle deadline out; call on any sign of life, e.g. a heartbeat. */
    keepAlive(timeoutMs = this.#options.idleTimeoutMs): void {
        clearTimeout(this.#idleTimer);
        if (timeoutMs === undefined || this.#stopped) return;
        this.#idleTimer = setTimeout(() => {
            console.warn(`[${this.#options.label}] no traffic for ${timeoutMs}ms, reconnecting`);
            this.reconnect(true);
        }, timeoutMs);
    }

    #connect(): void {
        if (this.#stopped) return;
        const ws = new WebSocket(this.#options.url());
        this.#ws = ws;
        ws.onopen = () => {
            this.#attempt = 0;
            this.keepAlive();
            this.#options.onOpen?.(this);
        };
        ws.onmessage = (event) => {
            this.keepAlive();
            if (typeof event.data === "string") this.#options.onMessage(event.data, this);
        };
        ws.onclose = () => {
            if (this.#ws !== ws) return;
            this.#ws = undefined;
            this.#options.onClose?.();
            this.reconnect();
        };
    }

    #teardown(): void {
        const ws = this.#ws;
        this.#ws = undefined;
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close();
    }
}
