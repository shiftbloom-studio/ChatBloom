import { buildPaintsQuery, PAINTS_PER_QUERY, parsePaintsRequest } from "./paints";
import {
    type CachePolicy,
    type GatewayRoute,
    matchRoute,
    PAINTS_ROUTE_ID,
    type RouteMatch,
} from "./routes";

/** The part of a Workers KV binding the gateway uses; structural, so tests can stand in for it. */
export interface KVLike {
    getWithMetadata(
        key: string,
        options: { type: "text"; cacheTtl?: number },
    ): Promise<{ value: string | null; metadata: unknown }>;
    put(
        key: string,
        value: string,
        options: { expirationTtl: number; metadata: EntryMetadata },
    ): Promise<void>;
}

/** Stored as KV metadata, so one read returns the body together with its age. */
export interface EntryMetadata {
    /** Stored at, in seconds since the epoch. */
    t: number;
    /** What the provider answered: 404 marks "no such channel here". */
    s: 200 | 404;
}

export type CacheStatus =
    /** Served from a fresh stored answer. */
    | "HIT"
    /** Nothing was stored; the provider was asked. */
    | "MISS"
    /** The stored answer was too old; the provider was asked. */
    | "EXPIRED"
    /** The stored answer is served while a refresh runs in the background. */
    | "UPDATING"
    /** The provider failed; the stored answer is served although it is too old. */
    | "STALE";

export type CacheLayer = "memory" | "kv" | "upstream";

/**
 * Counters for analytics, one per request. Deliberately free of ids: a route name says nothing
 * about a channel.
 */
export interface GatewayEvent {
    /** Id of the matched route, or `none` when the request was refused before it had one. */
    route: string;
    outcome: CacheStatus | "ERROR" | "REFUSED";
    layer?: CacheLayer;
    status: number;
}

export interface GatewayOptions {
    /** Identifies Petal to the providers; nothing the browser sent is passed on. */
    userAgent: string;
    fetch?: typeof fetch;
    /** Milliseconds since the epoch. */
    now?: () => number;
    /** Upper bound for the in-isolate copy of stored answers, in bytes. */
    memoryBudget?: number;
}

/** What differs per request: bindings may be missing, and background work belongs to a request. */
export interface RequestContext {
    kv?: KVLike;
    waitUntil: (work: Promise<unknown>) => void;
    /**
     * Asked before the provider is asked for something of which nothing is stored, at most
     * once per request. Answering false refuses the request with 429. This is where the
     * Worker counts misses per client: every miss costs a provider request and a KV write, so
     * somebody walking through channel ids must run dry long before the ordinary limit.
     */
    admit?: () => Promise<boolean>;
    /** Called once per request, with what became of it. */
    onEvent?: (event: GatewayEvent) => void;
}

interface Entry {
    body: string;
    status: 200 | 404;
    /** Milliseconds since the epoch. */
    storedAt: number;
}

type Loaded = Omit<Entry, "storedAt">;

interface Peeked {
    entry?: Entry;
    layer: CacheLayer;
}

interface Resolved {
    entry: Entry;
    cache: CacheStatus;
    layer: CacheLayer;
}

/** Bump when the stored shape changes, so old entries are ignored instead of misread. */
const KEY_PREFIX = "d1:";
/** KV refuses a shorter `expirationTtl`. */
const KV_MIN_TTL = 60;
/** How long a KV read may be answered from the edge location's own cache; the KV default. */
const KV_CACHE_TTL = 60;
/**
 * With nothing stored the overlay waits for the provider. It gives up on the gateway after
 * eight seconds, and the refusal has to reach it before that.
 */
const TIMEOUT_EMPTY_MS = 6000;
/** With a stored answer to fall back on, a slow provider is not worth waiting for. */
const TIMEOUT_STALE_MS = 4000;
/** A waiter stops following another request's fetch after this long. */
const FOLLOW_MS = TIMEOUT_EMPTY_MS + 1000;
const BACKOFF_FIRST_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** Above this many pauses the elapsed ones are dropped, so failing keys cannot pile up. */
const BACKOFF_ENTRIES = 500;
const NEGATIVE_STALE_IF_ERROR = 3600;
const MEMORY_BUDGET = 16 * 1024 * 1024;
/** Larger answers are read from KV every time rather than held in every isolate. */
const MEMORY_ENTRY_MAX = 1024 * 1024;
const PAINTS_BODY_MAX = 32 * 1024;
/** A defect fails every request alike, so one log line a minute says as much as all of them. */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/** Most telling first: what a response made of several paints reports. */
const OUTCOME_RANK: readonly CacheStatus[] = ["STALE", "MISS", "EXPIRED", "UPDATING", "HIT"];
const LAYER_RANK: readonly CacheLayer[] = ["upstream", "kv", "memory"];

export class GatewayError extends Error {
    readonly status: number;
    readonly code: string;
    /** Seconds. */
    readonly retryAfter?: number;

    constructor(status: number, code: string, retryAfter?: number) {
        super(code);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

/** Both rate limits of the Worker count over a minute, after which a client may try again. */
export const rateLimited = () => new GatewayError(429, "rate_limited", 60);

class UpstreamFailure extends Error {
    readonly rateLimited: boolean;
    /** Milliseconds the provider asked us to stay away, if it said so. */
    readonly retryAfterMs?: number;

    constructor(reason: string, rateLimited = false, retryAfterMs?: number) {
        super(reason);
        this.rateLimited = rateLimited;
        this.retryAfterMs = retryAfterMs;
    }
}

const freshFor = (entry: Entry, policy: CachePolicy) =>
    entry.status === 404 ? (policy.negativeFresh ?? 0) : policy.fresh;

const staleIfErrorFor = (entry: Entry, policy: CachePolicy) =>
    entry.status === 404 ? NEGATIVE_STALE_IF_ERROR : policy.staleIfError;

/** A 404 is never served while it is looked up again: the account may exist by now. */
const revalidateFor = (entry: Entry, policy: CachePolicy) =>
    entry.status === 404 ? 0 : policy.staleWhileRevalidate;

function parseRetryAfter(value: string | null, now: number): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Reads a body, giving up as soon as it outgrows `maxBytes`. */
async function readCapped(
    source: { body: ReadableStream<Uint8Array> | null; headers: Headers },
    maxBytes: number,
): Promise<string | undefined> {
    if (Number(source.headers.get("content-length") ?? 0) > maxBytes) {
        await source.body?.cancel();
        return undefined;
    }
    if (!source.body) return "";
    const reader = source.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            await reader.cancel();
            return undefined;
        }
        text += decoder.decode(value, { stream: true });
    }
}

function after(ms: number): { elapsed: Promise<undefined>; cancel: () => void } {
    let cancel = () => {};
    const elapsed = new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, ms, undefined);
        cancel = () => clearTimeout(timer);
    });
    return { elapsed, cancel };
}

/** The answer to a request the gateway does not serve, in the one shape the client knows. */
export function refusal(error: GatewayError): Response {
    const headers = new Headers({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        // Tells the client that the gateway itself refused, and not whatever else may
        // answer under this path, such as the dev server's 404 page.
        "x-petal-cache": "ERROR",
    });
    if (error.retryAfter !== undefined) headers.set("retry-after", String(error.retryAfter));
    if (error.status === 405) headers.set("allow", "GET, POST");
    return new Response(JSON.stringify({ error: error.code }), { status: error.status, headers });
}

/**
 * Caching reverse proxy for the providers' REST data. One instance lives as long as its isolate
 * and holds what KV cannot: the answers used most recently, the fetches under way, and which
 * providers asked to be left alone.
 */
export class DataGateway {
    readonly #userAgent: string;
    readonly #fetch: typeof fetch;
    readonly #now: () => number;
    readonly #memoryBudget: number;

    /** Insertion order is recency: a hit re-inserts, eviction takes from the front. */
    readonly #memory = new Map<string, Entry>();
    #memoryBytes = 0;
    readonly #refreshing = new Map<string, { startedAt: number; work: Promise<Entry> }>();
    /** Keyed by provider for rate limits, which hit every route, and by cache key otherwise. */
    readonly #backoff = new Map<string, { until: number; delay: number }>();
    #failureLoggedAt = Number.NEGATIVE_INFINITY;

    constructor(options: GatewayOptions) {
        this.#userAgent = options.userAgent;
        this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
        this.#now = options.now ?? Date.now;
        this.#memoryBudget = options.memoryBudget ?? MEMORY_BUDGET;
    }

    /** `path` is the undecoded URL path behind `/api/data`, e.g. `/7tv/v3/emote-sets/global`. */
    async handle(request: Request, path: string, context: RequestContext): Promise<Response> {
        const query = new URL(request.url).searchParams;
        const match = matchRoute(request.method, path, query);
        if (typeof match === "string") {
            const status = match === "method_not_allowed" ? 405 : 400;
            context.onEvent?.({ route: "none", outcome: "REFUSED", status });
            return refusal(new GatewayError(status, match));
        }
        const route = match.route.id;
        const { admit } = context;
        let admission: Promise<boolean> | undefined;
        const scoped: RequestContext = {
            ...context,
            admit: admit && (() => (admission ??= admit())),
        };
        try {
            const { body, status, cache, layer, storedAt } =
                route === PAINTS_ROUTE_ID
                    ? await this.#paints(request, match.route, scoped)
                    : await this.#resource(match, scoped);
            context.onEvent?.({ route, outcome: cache, layer, status });
            return new Response(body, {
                status,
                headers: {
                    "content-type": "application/json; charset=utf-8",
                    // The gateway alone decides how old data may be; a browser copy would
                    // add its own age on top.
                    "cache-control": "no-store",
                    "x-content-type-options": "nosniff",
                    "x-petal-cache": `${cache}; layer=${layer}`,
                    age: String(Math.max(0, Math.round((this.#now() - storedAt) / 1000))),
                },
            });
        } catch (error) {
            const failure = error instanceof GatewayError ? error : this.#defect(route, error);
            const outcome = failure.status < 500 ? "REFUSED" : "ERROR";
            context.onEvent?.({ route, outcome, status: failure.status });
            return refusal(failure);
        }
    }

    /** Anything thrown that is not a refusal is a fault of the gateway's own code. */
    #defect(route: string, error: unknown): GatewayError {
        if (this.#now() - this.#failureLoggedAt >= FAILURE_LOG_INTERVAL_MS) {
            this.#failureLoggedAt = this.#now();
            // The route id only: the path would name a channel.
            console.error("data gateway failed", route, error);
        }
        return new GatewayError(500, "gateway_failure");
    }

    async #resource(match: RouteMatch, context: RequestContext) {
        const { route } = match;
        const key = KEY_PREFIX + match.key;
        const peeked = await this.#peek(key, route.policy, context);
        const { entry, cache, layer } = await this.#settle(key, route, context, peeked, (ms) =>
            this.#loadRoute(route, route.upstream(match.params), ms),
        );
        return { body: entry.body, status: entry.status, cache, layer, storedAt: entry.storedAt };
    }

    /** The newest stored answer, from memory or KV, however old it is. */
    async #peek(key: string, policy: CachePolicy, context: RequestContext): Promise<Peeked> {
        const remembered = this.#recall(key);
        if (remembered && this.#age(remembered) < freshFor(remembered, policy)) {
            return { entry: remembered, layer: "memory" };
        }
        // Another isolate may have refreshed the entry since this one last looked.
        const stored = await this.#read(key, context);
        if (stored && (!remembered || stored.storedAt > remembered.storedAt)) {
            this.#remember(key, stored);
            return { entry: stored, layer: "kv" };
        }
        return { entry: remembered, layer: "memory" };
    }

    /**
     * Decides between the stored answer and the provider. `load` asks the provider and throws
     * when the answer is unusable.
     */
    async #settle(
        key: string,
        route: GatewayRoute,
        context: RequestContext,
        { entry, layer }: Peeked,
        load: (timeoutMs: number) => Promise<Loaded>,
    ): Promise<Resolved> {
        const { policy } = route;
        const refresh = (timeoutMs: number) =>
            this.#refresh(key, route, context, () => load(timeoutMs));
        const blocked = this.#blockedFor(key, route);

        if (!entry) {
            if (blocked > 0) {
                throw new GatewayError(503, "upstream_backoff", Math.ceil(blocked / 1000));
            }
            // Waiting for an answer that is already on its way costs nothing.
            if (!this.#running(key) && context.admit && !(await context.admit())) {
                throw rateLimited();
            }
            try {
                const loaded = await this.#follow(refresh(TIMEOUT_EMPTY_MS));
                return { entry: loaded, cache: "MISS", layer: "upstream" };
            } catch (error) {
                throw this.#unavailable(key, route, error);
            }
        }

        const age = this.#age(entry);
        const fresh = freshFor(entry, policy);
        if (age < fresh) return { entry, cache: "HIT", layer };
        const usable = age < fresh + staleIfErrorFor(entry, policy);
        if (usable && blocked > 0) return { entry, cache: "STALE", layer };
        if (usable && age < fresh + revalidateFor(entry, policy)) {
            // Failures are recorded by the refresh itself; the next request after the
            // backoff tries again.
            context.waitUntil(refresh(TIMEOUT_EMPTY_MS).catch(() => {}));
            return { entry, cache: "UPDATING", layer };
        }
        try {
            const renewed = await this.#follow(
                refresh(usable ? TIMEOUT_STALE_MS : TIMEOUT_EMPTY_MS),
            );
            return { entry: renewed, cache: "EXPIRED", layer: "upstream" };
        } catch (error) {
            if (usable) return { entry, cache: "STALE", layer };
            throw this.#unavailable(key, route, error);
        }
    }

    #unavailable(key: string, route: GatewayRoute, error: unknown): GatewayError {
        if (error instanceof GatewayError) return error;
        const blocked = Math.ceil(this.#blockedFor(key, route) / 1000);
        return new GatewayError(502, "upstream_unavailable", blocked > 0 ? blocked : undefined);
    }

    /**
     * Waits for a refresh that another request may own. Should that request be torn down
     * before its fetch ends, the promise may never settle, so a follower gives up rather than
     * hang with it.
     */
    async #follow(refresh: Promise<Entry>): Promise<Entry> {
        const limit = after(FOLLOW_MS);
        try {
            const result = await Promise.race([refresh, limit.elapsed]);
            if (!result) throw new UpstreamFailure("the refresh being followed never finished");
            return result;
        } finally {
            limit.cancel();
        }
    }

    /** Asks the provider once per key, however many requests are waiting for the answer. */
    #refresh(
        key: string,
        route: GatewayRoute,
        context: RequestContext,
        load: () => Promise<Loaded>,
    ): Promise<Entry> {
        const running = this.#running(key);
        if (running) return running;
        const startedAt = this.#now();
        const work = (async () => {
            try {
                const entry: Entry = { ...(await load()), storedAt: this.#now() };
                this.#backoff.delete(key);
                this.#backoff.delete(route.provider);
                this.#store(key, entry, route.policy, context);
                return entry;
            } catch (error) {
                this.#failed(key, route, error);
                throw error;
            } finally {
                // Unless given up and replaced in the meantime.
                if (this.#refreshing.get(key)?.startedAt === startedAt) {
                    this.#refreshing.delete(key);
                }
            }
        })();
        this.#refreshing.set(key, { startedAt, work });
        // Lets the fetch finish when the request that started it is answered or gone.
        context.waitUntil(work.catch(() => {}));
        return work;
    }

    /**
     * The refresh of a key that is under way. One that was torn down with the request that
     * started it never ends, and would hold up its key for as long as the isolate lives: it
     * is given up once it has taken longer than any refresh may.
     */
    #running(key: string): Promise<Entry> | undefined {
        const running = this.#refreshing.get(key);
        if (!running) return undefined;
        if (this.#now() - running.startedAt < FOLLOW_MS) return running.work;
        this.#refreshing.delete(key);
        return undefined;
    }

    #failed(key: string, route: GatewayRoute, error: unknown): void {
        const failure = error instanceof UpstreamFailure ? error : undefined;
        const scope = failure?.rateLimited ? route.provider : key;
        const previous = this.#backoff.get(scope)?.delay ?? 0;
        const doubled = previous === 0 ? BACKOFF_FIRST_MS : previous * 2;
        const delay = Math.min(BACKOFF_MAX_MS, Math.max(doubled, failure?.retryAfterMs ?? 0));
        // Jitter, so isolates that failed together do not come back together.
        const until = this.#now() + delay * (0.75 + Math.random() / 2);
        this.#backoff.set(scope, { until, delay });
        if (this.#backoff.size > BACKOFF_ENTRIES) {
            for (const [stale, pause] of this.#backoff) {
                if (pause.until < this.#now()) this.#backoff.delete(stale);
            }
        }
    }

    /** Milliseconds for which the provider must not be asked for this key. */
    #blockedFor(key: string, route: GatewayRoute): number {
        const until = Math.max(
            this.#backoff.get(key)?.until ?? 0,
            this.#backoff.get(route.provider)?.until ?? 0,
        );
        return Math.max(0, until - this.#now());
    }

    async #loadRoute(route: GatewayRoute, url: string, timeoutMs: number): Promise<Loaded> {
        const response = await this.#ask(url, timeoutMs);
        if (response.status === 404 && route.policy.negativeFresh !== undefined) {
            await response.body?.cancel();
            return { status: 404, body: "null" };
        }
        const json = await this.#json(response, route.policy.maxBytes);
        return { status: 200, body: JSON.stringify(route.transform?.(json) ?? json) };
    }

    /**
     * The provider sees the gateway's own headers and nothing of the browser's request. With
     * a `body` the request is a POST of JSON.
     */
    async #ask(url: string, timeoutMs: number, body?: string): Promise<Response> {
        let response: Response;
        try {
            response = await this.#fetch(url, {
                method: body === undefined ? "GET" : "POST",
                headers: {
                    accept: "application/json",
                    "user-agent": this.#userAgent,
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                },
                body,
                // A redirect would leave the allowlisted host.
                redirect: "manual",
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            throw new UpstreamFailure(`fetch failed: ${String(error)}`);
        }
        if (response.status === 200 || response.status === 404) return response;
        await response.body?.cancel();
        throw new UpstreamFailure(
            `answered ${response.status}`,
            response.status === 429,
            parseRetryAfter(response.headers.get("retry-after"), this.#now()),
        );
    }

    async #json(response: Response, maxBytes: number): Promise<unknown> {
        const type = response.headers.get("content-type") ?? "";
        if (response.status !== 200 || !/^application\/(?:[\w.-]+\+)?json\b/i.test(type)) {
            await response.body?.cancel();
            throw new UpstreamFailure(`answered ${response.status} ${type}`);
        }
        let text: string | undefined;
        try {
            text = await readCapped(response, maxBytes);
        } catch (error) {
            throw new UpstreamFailure(`body failed: ${String(error)}`);
        }
        if (text === undefined) throw new UpstreamFailure("body too large");
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            throw new UpstreamFailure("body is not JSON");
        }
        if (typeof json !== "object" || json === null) {
            throw new UpstreamFailure("body is not a JSON object or array");
        }
        return json;
    }

    #age(entry: Entry): number {
        return (this.#now() - entry.storedAt) / 1000;
    }

    #recall(key: string): Entry | undefined {
        const entry = this.#memory.get(key);
        if (!entry) return undefined;
        this.#memory.delete(key);
        this.#memory.set(key, entry);
        return entry;
    }

    /** A string may take two bytes per character; assuming so errs on the safe side. */
    #weight(entry: Entry): number {
        return entry.body.length * 2 + 64;
    }

    #remember(key: string, entry: Entry): void {
        const previous = this.#memory.get(key);
        if (previous) {
            this.#memoryBytes -= this.#weight(previous);
            this.#memory.delete(key);
        }
        if (this.#weight(entry) > Math.min(MEMORY_ENTRY_MAX, this.#memoryBudget)) return;
        this.#memory.set(key, entry);
        this.#memoryBytes += this.#weight(entry);
        for (const [oldest, evicted] of this.#memory) {
            if (this.#memoryBytes <= this.#memoryBudget) break;
            this.#memory.delete(oldest);
            this.#memoryBytes -= this.#weight(evicted);
        }
    }

    /** KV trouble never fails a request: the gateway then works from memory and the provider. */
    async #read(key: string, context: RequestContext): Promise<Entry | undefined> {
        if (!context.kv) return undefined;
        try {
            const { value, metadata } = await context.kv.getWithMetadata(key, {
                type: "text",
                cacheTtl: KV_CACHE_TTL,
            });
            const meta = metadata as Partial<EntryMetadata> | null;
            if (value === null || typeof meta?.t !== "number") return undefined;
            return { body: value, status: meta.s === 404 ? 404 : 200, storedAt: meta.t * 1000 };
        } catch {
            return undefined;
        }
    }

    #store(key: string, entry: Entry, policy: CachePolicy, context: RequestContext): void {
        this.#remember(key, entry);
        if (!context.kv) return;
        const lifetime = freshFor(entry, policy) + staleIfErrorFor(entry, policy);
        try {
            // KV takes one write per key and second. When two isolates refresh at once the
            // second write is refused, which is harmless: both hold the same data.
            const write = context.kv
                .put(key, entry.body, {
                    expirationTtl: Math.max(KV_MIN_TTL, Math.ceil(lifetime)),
                    metadata: { t: Math.floor(entry.storedAt / 1000), s: entry.status },
                })
                .catch(() => {});
            context.waitUntil(write);
        } catch {
            // A binding that throws instead of rejecting must not fail the request either.
        }
    }

    /**
     * 7TV paints. The client sends the GraphQL request it would send to 7TV, but only the ids
     * in its variables are read: the query sent upstream is always the gateway's own, so the
     * endpoint cannot run any other GraphQL. Paints are stored one by one, because every
     * overlay asks for a different combination of them.
     */
    async #paints(request: Request, route: GatewayRoute, context: RequestContext) {
        let text: string | undefined;
        try {
            text = await readCapped(request, PAINTS_BODY_MAX);
        } catch {
            throw new GatewayError(400, "invalid_body");
        }
        if (text === undefined) throw new GatewayError(413, "body_too_large");
        const ids = parsePaintsRequest(text);
        if (!ids) throw new GatewayError(400, "invalid_body");

        const unique = [...new Set(ids)];
        const keys = unique.map((id) => `${KEY_PREFIX}7tv.paint:${id}`);
        const peeked = await Promise.all(keys.map((key) => this.#peek(key, route.policy, context)));

        // Paints that turn to the provider in the same tick share one batch, which leaves
        // once the tick is over. Whoever comes later starts the next batch.
        let collecting: { ids: string[]; timeoutMs: number } | undefined;
        let leaving: Promise<Map<string, Loaded>> | undefined;
        const load = async (id: string, timeoutMs: number): Promise<Loaded> => {
            if (!collecting || !leaving) {
                const batch = { ids: [] as string[], timeoutMs: 0 };
                collecting = batch;
                leaving = Promise.resolve().then(() => {
                    collecting = undefined;
                    return this.#loadPaints(route, batch.ids, batch.timeoutMs);
                });
            }
            collecting.ids.push(id);
            collecting.timeoutMs = Math.max(collecting.timeoutMs, timeoutMs);
            const loaded = (await leaving).get(id);
            if (!loaded) throw new UpstreamFailure("paint missing from the answer");
            return loaded;
        };
        const settled = await Promise.allSettled(
            unique.map((id, index) =>
                this.#settle(keys[index], route, context, peeked[index], (timeoutMs) =>
                    load(id, timeoutMs),
                ),
            ),
        );

        const paints = new Map<string, Resolved>();
        for (const [index, result] of settled.entries()) {
            // The client could not tell a paint that failed to load from one that does not
            // exist and would leave it unpainted; a failed request sends it to 7TV instead.
            if (result.status === "rejected") throw result.reason;
            paints.set(unique[index], result.value);
        }
        const resolved = [...paints.values()];
        const fields = ids.map((id, index) => `"p${index}":${paints.get(id)?.entry.body}`);
        return {
            body: `{"data":{"paints":{${fields.join(",")}}}}`,
            status: 200,
            cache: OUTCOME_RANK.find((o) => resolved.some((r) => r.cache === o)) ?? "HIT",
            layer: LAYER_RANK.find((l) => resolved.some((r) => r.layer === l)) ?? "memory",
            storedAt: Math.min(...resolved.map((r) => r.entry.storedAt)),
        };
    }

    /** One query per {@link PAINTS_PER_QUERY} paints; 7TV refuses larger ones as too complex. */
    async #loadPaints(
        route: GatewayRoute,
        ids: readonly string[],
        timeoutMs: number,
    ): Promise<Map<string, Loaded>> {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += PAINTS_PER_QUERY) {
            chunks.push(ids.slice(i, i + PAINTS_PER_QUERY));
        }
        const loaded = new Map<string, Loaded>();
        await Promise.all(
            chunks.map(async (chunk) => {
                const response = await this.#ask(
                    route.upstream({}),
                    timeoutMs,
                    JSON.stringify(buildPaintsQuery(chunk)),
                );
                const json = (await this.#json(response, route.policy.maxBytes)) as {
                    data?: { paints?: Record<string, unknown> | null } | null;
                    errors?: unknown;
                };
                // GraphQL reports failures with status 200, and one bad field voids them all.
                const paints = json.data?.paints;
                if (json.errors || !paints) throw new UpstreamFailure("GraphQL error");
                for (const [index, id] of chunk.entries()) {
                    const paint = paints[`p${index}`];
                    loaded.set(
                        id,
                        paint
                            ? { status: 200, body: JSON.stringify(paint) }
                            : { status: 404, body: "null" },
                    );
                }
            }),
        );
        return loaded;
    }
}
