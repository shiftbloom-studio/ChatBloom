import { isAutomated } from "../server/bots";
import { record, recordGateway } from "./analytics";
import type { Env } from "./env";
import { handleData } from "./gateway/index";
import type { HubStatus } from "./hub";
import { withinLimit } from "./rate-limit";
import { normaliseChannel, shardOf } from "./relay/shard";

const DEFAULT_SHARDS = 4;
/** A slip such as `400` would make every status request wake that many hubs. */
const MAX_SHARDS = 64;

/**
 * A hub is created near whoever reaches it first and never moves afterwards. The hint places
 * it in Western Europe, near the streamers, even when a monitor on another continent asks
 * for the status before the first overlay connects.
 */
const HUB_LOCATION: DurableObjectLocationHint = "weur";

/** An overlay gives the relay 15 seconds; answering sooner sends it to Twitch sooner. */
const HUB_TIMEOUT_MS = 5000;
const STATUS_TIMEOUT_MS = 3000;

const DATA_PREFIX = "/api/data/";

/** Responses under `/api/` never pass through Nitro, so they bring their own headers. */
const JSON_HEADERS = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
};

/**
 * Every answer of the gateway carries this header; the overlay tells by it that the gateway
 * itself answered, and asks the provider directly.
 */
const GATEWAY_REFUSED = { "x-petal-cache": "ERROR" };

/** What a hub reports about itself, under the number the Worker knows it by. */
export type ShardStatus =
    | (Omit<HubStatus, "shard" | "available"> & { shard: number; available: true })
    | { shard: number; available: false };

export interface ApiStatus {
    /** Of the running deployment; `null` where the binding is missing. */
    version: WorkerVersionMetadata | null;
    relayEnabled: boolean;
    /** Whether a hub has paused itself; its entry in `shards` says why and for how long. */
    relayPaused: boolean;
    shards: ShardStatus[];
}

/** Replaced in unit tests, which must not reach the providers. */
export interface ApiHandlers {
    data: typeof handleData;
}

const HANDLERS: ApiHandlers = { data: handleData };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...JSON_HEADERS, ...headers },
    });
}

function refuse(code: string, status: number, headers?: Record<string, string>): Response {
    return json({ error: code }, status, headers);
}

function refuseChat(
    env: Env,
    code: string,
    status: number,
    headers?: Record<string, string>,
): Response {
    record(env, { event: "irc-refused", labels: [code], values: [status] });
    return refuse(code, status, headers);
}

/** For what happens once the shard is known, so the counters tell which hub is in trouble. */
function relayUnavailable(env: Env, shard: number): Response {
    record(env, { event: "irc-refused", labels: ["relay_unavailable"], values: [503, shard] });
    return refuse("relay_unavailable", 503);
}

/** Rejects when `work` takes longer, so a hub that hangs cannot hold a request open. */
function within<T>(milliseconds: number, work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out")), milliseconds);
        work.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

export function relayEnabled(env: Env): boolean {
    const value = env.RELAY_ENABLED?.trim().toLowerCase();
    // Whoever pulls the emergency switch in a hurry may write it in any of these ways.
    return value !== "false" && value !== "0" && value !== "off" && value !== "no";
}

export function shardCount(env: Env): number {
    const raw = env.RELAY_SHARDS?.trim() ?? "";
    const count = /^\d+$/.test(raw) ? Number(raw) : 0;
    return count >= 1 && count <= MAX_SHARDS ? count : DEFAULT_SHARDS;
}

function hub(env: Env, shard: number): DurableObjectStub {
    const id = env.CHAT_HUB.idFromName(`hub-${shard}`);
    return env.CHAT_HUB.get(id, { locationHint: HUB_LOCATION });
}

/**
 * Sockets are not subject to the same-origin policy, so any website could make its visitors'
 * browsers use this relay. Programs other than browsers send no origin, and a page in a
 * sandboxed frame sends `null`; both pass.
 */
function foreignOrigin(request: Request, url: URL): boolean {
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    try {
        return new URL(origin).host !== url.host;
    } catch {
        return true;
    }
}

/**
 * The relay and the gateway hand out what the chat pages show, so they refuse whom the pages
 * refuse (`src/server/block-bots.ts`). A script that opens a socket does not load the page
 * first. The status is for monitors, which are programs, and stays open to them.
 */
function automated(request: Request): boolean {
    return isAutomated(request.headers.get("user-agent"));
}

async function chat(request: Request, env: Env, url: URL): Promise<Response> {
    // Before everything else, so a program learns nothing else about the relay.
    if (automated(request)) {
        return refuseChat(env, "automated_client", 403);
    }
    if (request.method !== "GET") {
        return refuseChat(env, "method_not_allowed", 405, { allow: "GET" });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return refuseChat(env, "upgrade_required", 426, { upgrade: "websocket" });
    }
    if (!relayEnabled(env)) {
        return refuseChat(env, "relay_disabled", 503);
    }
    if (foreignOrigin(request, url)) {
        return refuseChat(env, "foreign_origin", 403);
    }
    const channel = normaliseChannel(url.searchParams.get("channel"));
    if (!channel) {
        return refuseChat(env, "invalid_channel", 400);
    }
    if (!(await withinLimit(env.RATE_LIMIT, "irc", request))) {
        return refuseChat(env, "rate_limited", 429, { "retry-after": "60" });
    }

    const shard = shardOf(channel, shardCount(env));
    let response: Response;
    try {
        response = await within(HUB_TIMEOUT_MS, hub(env, shard).fetch(request));
    } catch (error) {
        console.error("hub did not take the connection", shard, error);
        return relayUnavailable(env, shard);
    }
    if (response.status === 101) {
        record(env, { event: "irc-connect", values: [shard] });
        // Returned as is: the response carries the client's end of the socket pair.
        return response;
    }
    if (response.status >= 400) {
        // A hub that is full says so in the manner of this module. Not logged: under load
        // that would be a line per refused overlay.
        record(env, {
            event: "irc-refused",
            labels: ["hub_refused"],
            values: [response.status, shard],
        });
        return response;
    }
    console.error("hub answered the upgrade with status", response.status, shard);
    return relayUnavailable(env, shard);
}

async function shardStatus(env: Env, shard: number): Promise<ShardStatus> {
    try {
        const status = await within(
            STATUS_TIMEOUT_MS,
            hub(env, shard)
                .fetch(`https://hub/api/status?shard=${shard}`)
                .then((response) => {
                    if (!response.ok) throw new Error(`status ${response.status}`);
                    return response.json<HubStatus>();
                }),
        );
        return { ...status, shard, available: true };
    } catch (error) {
        console.error("hub did not report its status", shard, error);
        return { shard, available: false };
    }
}

async function status(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
        return refuse("method_not_allowed", 405, { allow: "GET" });
    }
    // Every status request is one request to every hub and keeps idle hubs in memory.
    if (!(await withinLimit(env.RATE_LIMIT, "status", request))) {
        return refuse("rate_limited", 429, { "retry-after": "60" });
    }
    const shards = await Promise.all(
        Array.from({ length: shardCount(env) }, (_, shard) => shardStatus(env, shard)),
    );
    const body: ApiStatus = {
        version: env.CF_VERSION_METADATA ?? null,
        relayEnabled: relayEnabled(env),
        relayPaused: shards.some((shard) => shard.available && Boolean(shard.pause)),
        shards,
    };
    return json(body);
}

/**
 * Handles every request under `/api/`; the rest of the site never reaches this module.
 *
 * Nothing here may throw: an uncaught exception is answered with Cloudflare's HTML error page,
 * while a plain refusal sends the overlay to its direct connections at once.
 */
export async function handleApi(
    request: Request,
    env: Env,
    context: ExecutionContext,
    url: URL,
    handlers: ApiHandlers = HANDLERS,
): Promise<Response> {
    const data = url.pathname.startsWith(DATA_PREFIX);
    try {
        if (data) {
            if (automated(request)) {
                recordGateway(env, { route: "none", outcome: "REFUSED", status: 403 });
                return refuse("automated_client", 403, GATEWAY_REFUSED);
            }
            return await handlers.data(request, env, context, url, (event) =>
                recordGateway(env, event),
            );
        }
        if (url.pathname === "/api/irc") return await chat(request, env, url);
        if (url.pathname === "/api/status") return await status(request, env);
        return refuse("not_found", 404);
    } catch (error) {
        // Neither the path nor the query is logged: both can name a channel.
        console.error("api request failed", data ? "data" : url.pathname, error);
        return refuse("unavailable", 503, data ? GATEWAY_REFUSED : undefined);
    }
}
