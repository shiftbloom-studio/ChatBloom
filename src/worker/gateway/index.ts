import { withinLimit } from "../rate-limit";
import { DataGateway, type GatewayEvent, rateLimited, refusal } from "./gateway";

export type { CacheLayer, CacheStatus, GatewayEvent } from "./gateway";

/**
 * The bindings the gateway reads, which the Worker's `Env` satisfies. All of them are optional:
 * without KV the gateway works from memory and the providers, without the rate limits it
 * admits everybody.
 */
export interface GatewayEnv {
    CACHE?: KVNamespace;
    /** Counts every request of a client. */
    RATE_LIMIT?: RateLimit;
    /** Counts the requests of a client for which the provider has to be asked. */
    RATE_LIMIT_MISS?: RateLimit;
}

/** Receives the counters of one request; see {@link GatewayEvent}. */
export type GatewayEventListener = (event: GatewayEvent) => void;

const DATA_PREFIX = "/api/data";
/** Tells the providers who is asking and where to complain. */
const USER_AGENT = "Petal (+https://github.com/shiftbloom-studio/petal)";

/** Lives as long as the isolate, and with it what it holds in memory. */
let gateway: DataGateway | undefined;

/**
 * Answers a request under `/api/data/`. `onEvent` is called once per request with counters
 * for analytics; what it throws is dropped, so that counting can never fail a request.
 */
export async function handleData(
    request: Request,
    env: GatewayEnv,
    context: ExecutionContext,
    url: URL,
    onEvent?: GatewayEventListener,
): Promise<Response> {
    const report = (event: GatewayEvent) => {
        try {
            onEvent?.(event);
        } catch {
            // Counters are an extra.
        }
    };
    if (!(await withinLimit(env.RATE_LIMIT, "data", request))) {
        report({ route: "none", outcome: "REFUSED", status: 429 });
        return refusal(rateLimited());
    }
    gateway ??= new DataGateway({ userAgent: USER_AGENT });
    return gateway.handle(request, url.pathname.slice(DATA_PREFIX.length), {
        kv: env.CACHE,
        waitUntil: (work) => context.waitUntil(work),
        admit: () => withinLimit(env.RATE_LIMIT_MISS, "miss", request),
        onEvent: report,
    });
}
