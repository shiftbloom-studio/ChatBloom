import type {
    EntryMetadata,
    GatewayEvent,
    KVLike,
    RequestContext,
} from "../../../src/worker/gateway/gateway";

interface StoredValue {
    value: string;
    metadata: EntryMetadata;
    /** Milliseconds since the epoch at which KV drops the value. */
    expiresAt: number;
}

/** In-memory stand-in for a KV namespace that enforces the limits the gateway must respect. */
export class FakeKV implements KVLike {
    readonly values = new Map<string, StoredValue>();
    /** Every read and write, e.g. `get d1:bttv.global`. */
    readonly operations: string[] = [];
    readonly #now: () => number;
    failReads = false;
    failWrites = false;

    constructor(now: () => number) {
        this.#now = now;
    }

    async getWithMetadata(key: string, options: { type: "text"; cacheTtl?: number }) {
        this.operations.push(`get ${key}`);
        if (options.cacheTtl !== undefined && options.cacheTtl < 30) {
            throw new Error("KV GET failed: 400 Invalid cache_ttl of less than 30");
        }
        if (this.failReads) throw new Error("KV GET failed: 500 Internal Server Error");
        const stored = this.values.get(key);
        if (!stored || stored.expiresAt <= this.#now()) return { value: null, metadata: null };
        return { value: stored.value, metadata: stored.metadata };
    }

    async put(
        key: string,
        value: string,
        options: { expirationTtl: number; metadata: EntryMetadata },
    ) {
        this.operations.push(`put ${key}`);
        if (this.failWrites) throw new Error("KV PUT failed: 429 Too Many Requests");
        if (new TextEncoder().encode(key).byteLength > 512) throw new Error("key too long");
        if (options.expirationTtl < 60) {
            throw new Error("KV PUT failed: 400 Invalid expiration_ttl of less than 60");
        }
        if (JSON.stringify(options.metadata).length > 1024) throw new Error("metadata too large");
        this.values.set(key, {
            value,
            metadata: options.metadata,
            expiresAt: this.#now() + options.expirationTtl * 1000,
        });
    }
}

export class Clock {
    ms = Date.UTC(2026, 8, 29, 12);
    now = () => this.ms;

    advance(seconds: number): void {
        this.ms += seconds * 1000;
    }
}

export interface UpstreamCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect?: string;
}

type Answer = Response | (() => Response | Promise<Response>);

/** Stands in for the providers: answers by URL and records what the gateway sent. */
export class FakeUpstream {
    readonly calls: UpstreamCall[] = [];
    readonly #answers = new Map<string, Answer>();

    answer(url: string, answer: Answer): void {
        this.#answers.set(url, answer);
    }

    json(url: string, body: unknown, status = 200): void {
        this.answer(url, () => jsonResponse(body, status));
    }

    fetch: typeof fetch = async (input, init) => {
        const url = String(input);
        this.calls.push({
            url,
            method: init?.method ?? "GET",
            headers: Object.fromEntries(new Headers(init?.headers)),
            body: typeof init?.body === "string" ? init.body : undefined,
            redirect: init?.redirect,
        });
        const answer = this.#answers.get(url);
        if (!answer) throw new TypeError(`fetch failed: no answer for ${url}`);
        return typeof answer === "function" ? answer() : answer.clone();
    };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });
}

/** Collects background work like a Worker's `ctx.waitUntil`, to be awaited by the test. */
export class Background {
    readonly #work: Promise<unknown>[] = [];

    context(
        kv?: KVLike,
        admit?: () => Promise<boolean>,
        onEvent?: (event: GatewayEvent) => void,
    ): RequestContext {
        return { kv, admit, onEvent, waitUntil: (work) => void this.#work.push(work) };
    }

    async settle(): Promise<void> {
        while (this.#work.length > 0) await Promise.allSettled(this.#work.splice(0));
    }
}
