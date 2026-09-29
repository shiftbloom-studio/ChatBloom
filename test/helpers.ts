/** In-memory stand-in for the browser WebSocket, driven by the test. */
export class FakeWebSocket {
    static readonly OPEN = 1;
    static instances: FakeWebSocket[] = [];

    readonly url: string;
    readyState = 0;
    /** Raw frames the client sent. */
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    /** Frames the client sent, parsed as JSON. */
    get sentJson(): unknown[] {
        return this.sent.map((frame) => JSON.parse(frame));
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = 3;
    }

    /** Test side: the server accepts the connection. */
    accept(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    /** Test side: the server sends a frame; non-strings are sent as JSON. */
    receive(frame: unknown): void {
        this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
    }

    /** Test side: the server drops the connection. */
    drop(): void {
        this.readyState = 3;
        this.onclose?.();
    }

    static get latest(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1);
        if (!socket) throw new Error("no socket was opened");
        return socket;
    }
}

/** Swaps in {@link FakeWebSocket} for one test; returns the restore function. */
export function useFakeWebSocket(): () => void {
    const original = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    return () => {
        globalThis.WebSocket = original;
    };
}

/** Answers a stubbed fetch() by itself, for answers with headers and for requests that fail. */
export type FetchAnswer = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Answers fetch() from a URL-to-body table and records every request. A number body is sent as
 * that status and a {@link FetchAnswer} is called. Returns the restore function.
 */
export function stubFetch(routes: Record<string, unknown>) {
    const original = globalThis.fetch;
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push({ url, init });
        if (!(url in routes)) throw new Error(`unexpected fetch: ${url}`);
        const body = routes[url];
        if (typeof body === "function") return (body as FetchAnswer)(init);
        return typeof body === "number"
            ? new Response("{}", { status: body })
            : new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const restore = () => {
        globalThis.fetch = original;
    };
    return Object.assign(restore, { calls });
}

/** Pretends the page was loaded from `href`; returns the restore function. */
export function useLocation(href: string): () => void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: new URL(href), configurable: true });
    return () => {
        if (original) Object.defineProperty(globalThis, "location", original);
        else Reflect.deleteProperty(globalThis, "location");
    };
}

/** A mock handler that records the arguments of every call. */
export function recorder<Args extends unknown[]>() {
    const calls: Args[] = [];
    const fn = (...args: Args) => {
        calls.push(args);
    };
    return Object.assign(fn, { calls });
}
