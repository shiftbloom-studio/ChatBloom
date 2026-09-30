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

    send(data: string) {
        this.sent.push(data);
    }

    close() {
        this.readyState = 3;
    }

    /** Test side: the server accepts the connection. */
    accept() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    /** Test side: the server sends a frame. */
    receive(data: string) {
        this.onmessage?.({ data });
    }

    /** Test side: the server drops the connection. */
    drop() {
        this.close();
        this.onclose?.();
    }
}

/** Swaps in {@link FakeWebSocket} for one test; returns the restore function. */
export function useFakeWebSocket() {
    const original = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    return () => Reflect.set(globalThis, "WebSocket", original);
}

/** Answers a stubbed fetch() by itself, for answers with headers and for requests that fail. */
export type FetchAnswer = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Answers fetch() from a URL table of status numbers, FetchAnswers and bodies sent as JSON. */
export function stubFetch(routes: Record<string, unknown>) {
    const original = globalThis.fetch;
    const calls: { url: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url });
        const body = routes[url];
        if (typeof body === "function") return (body as FetchAnswer)(init);
        if (typeof body === "number") return new Response("{}", { status: body });
        return new Response(JSON.stringify(body));
    }) as typeof fetch;
    return Object.assign(() => Reflect.set(globalThis, "fetch", original), { calls });
}

/** Pretends the page was loaded from `href`; returns the restore function. */
export function useLocation(href: string) {
    Object.defineProperty(globalThis, "location", { value: new URL(href), configurable: true });
    return () => void Reflect.deleteProperty(globalThis, "location");
}

/** A mock handler that records the arguments of every call. */
export function recorder<Args extends unknown[]>() {
    const calls: Args[] = [];
    return Object.assign((...args: Args) => void calls.push(args), { calls });
}
