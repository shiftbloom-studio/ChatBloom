import { DurableObject } from "cloudflare:workers";
import { record } from "./analytics";
import {
    CLIENT_PING,
    CLIENT_PONG,
    CLOSE_INTERNAL,
    CLOSE_NORMAL,
    HUB_DEFAULTS,
    type HubConfig,
    HubCore,
    type HubTick,
    type PauseReason,
    type PauseStart,
} from "./relay/core";
import { normaliseChannel } from "./relay/shard";
import { SYSTEM_RUNTIME, UPSTREAM_DEFAULTS } from "./relay/upstream";

export type { HubStatus } from "./relay/core";

/** What the hub reads of the Worker's bindings and variables; all of it is optional. */
export interface HubEnv {
    ANALYTICS?: AnalyticsEngineDataset;
    TWITCH_IRC_URL?: string;
    MAX_CHANNELS_PER_UPSTREAM?: string;
    MAX_CLIENTS_PER_HUB?: string;
    MAX_CHANNELS_PER_HUB?: string;
    /** `0` switches the replay off. */
    REPLAY_LINES?: string;
    PART_GRACE_MS?: string;
    WATCHDOG_MS?: string;
    /** The safety switch; `0` switches a threshold off. */
    RELAY_PAUSE_CLIENTS?: string;
    RELAY_PAUSE_CHANNELS?: string;
    RELAY_PAUSE_CONNECTS_PER_MINUTE?: string;
    RELAY_PAUSE_LINES_PER_MINUTE?: string;
    RELAY_PAUSE_FRAMES_PER_MINUTE?: string;
    RELAY_PAUSE_MINUTES?: string;
}

const DEFAULT_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
/** The name the Worker gives the object. */
const HUB_NAME = /^hub-(\d+)$/;
/** Where the storage keeps a pause. */
const PAUSE_UNTIL = "pause-until";
const PAUSE_REASON = "pause-reason";
const MINUTE_MS = 60_000;

/** The close codes of RFC 6455 and its registry that an endpoint may send. */
const SENDABLE_CLOSE = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013]);

/** Responses of the hub never pass through Nitro, so they bring their own headers. */
const JSON_HEADERS = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...JSON_HEADERS, ...headers },
    });
}

function refuse(code: string, status: number, headers?: Record<string, string>): Response {
    return json({ error: code }, status, headers);
}

function count(raw: string | undefined, fallback: number, least: number): number {
    const value = /^\d+$/.test(raw?.trim() ?? "") ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(value) && value >= least ? value : fallback;
}

/**
 * The Durable Object around `HubCore`: it owns what only the Workers runtime has, which is
 * the hibernatable sockets, the alarm and the bindings. Everything else lives in the core,
 * where it is tested without the runtime.
 */
export class ChatHub extends DurableObject<HubEnv> {
    protected readonly core: HubCore<WebSocket>;
    #shard: number | null;

    constructor(ctx: DurableObjectState, env: HubEnv) {
        super(ctx, env);
        const name = HUB_NAME.exec(ctx.id.name ?? "");
        this.#shard = name ? Number(name[1]) : null;
        this.core = new HubCore<WebSocket>(
            this.config(env),
            {
                now: () => Date.now(),
                sockets: () => ctx.getWebSockets(),
                keptAliveAt: (socket) => ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime(),
                getAlarm: () => ctx.storage.getAlarm(),
                setAlarm: (at) => ctx.storage.setAlarm(at),
                storedPause: async () => {
                    const stored = await ctx.storage.get([PAUSE_UNTIL, PAUSE_REASON]);
                    return { until: stored.get(PAUSE_UNTIL), reason: stored.get(PAUSE_REASON) };
                },
                storePause: (until, reason) =>
                    ctx.storage.put({ [PAUSE_UNTIL]: until, [PAUSE_REASON]: reason }),
                forgetPause: async () => {
                    await ctx.storage.delete([PAUSE_UNTIL, PAUSE_REASON]);
                },
                report: (tick) => this.#report(tick),
                reset: () => ctx.abort("hub reset itself"),
                paused: (pause) => this.#paused(pause),
                resumed: (reason) => this.#resumed(reason),
            },
            SYSTEM_RUNTIME,
        );
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(CLIENT_PING, CLIENT_PONG));
        ctx.blockConcurrencyWhile(() => this.core.restore());
    }

    protected config(env: HubEnv): HubConfig {
        return {
            upstream: {
                ...UPSTREAM_DEFAULTS,
                url: env.TWITCH_IRC_URL?.trim() || DEFAULT_IRC_URL,
                maxChannelsPerConnection: count(
                    env.MAX_CHANNELS_PER_UPSTREAM,
                    UPSTREAM_DEFAULTS.maxChannelsPerConnection,
                    1,
                ),
            },
            ...HUB_DEFAULTS,
            replayLines: count(env.REPLAY_LINES, HUB_DEFAULTS.replayLines, 0),
            graceMs: count(env.PART_GRACE_MS, HUB_DEFAULTS.graceMs, 1),
            watchdogMs: count(env.WATCHDOG_MS, HUB_DEFAULTS.watchdogMs, 1000),
            maxClients: count(env.MAX_CLIENTS_PER_HUB, HUB_DEFAULTS.maxClients, 1),
            maxChannels: count(env.MAX_CHANNELS_PER_HUB, HUB_DEFAULTS.maxChannels, 1),
            pauseClients: count(env.RELAY_PAUSE_CLIENTS, HUB_DEFAULTS.pauseClients, 0),
            pauseChannels: count(env.RELAY_PAUSE_CHANNELS, HUB_DEFAULTS.pauseChannels, 0),
            pauseConnectsPerMinute: count(
                env.RELAY_PAUSE_CONNECTS_PER_MINUTE,
                HUB_DEFAULTS.pauseConnectsPerMinute,
                0,
            ),
            pauseLinesPerMinute: count(
                env.RELAY_PAUSE_LINES_PER_MINUTE,
                HUB_DEFAULTS.pauseLinesPerMinute,
                0,
            ),
            pauseFramesPerMinute: count(
                env.RELAY_PAUSE_FRAMES_PER_MINUTE,
                HUB_DEFAULTS.pauseFramesPerMinute,
                0,
            ),
            pauseMs:
                count(env.RELAY_PAUSE_MINUTES, HUB_DEFAULTS.pauseMs / MINUTE_MS, 1) * MINUTE_MS,
        };
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname !== "/api/irc" && url.pathname !== "/api/status") {
            return refuse("not_found", 404);
        }
        if (request.method !== "GET") return refuse("method_not_allowed", 405, { allow: "GET" });
        if (url.pathname === "/api/status") {
            // The object cannot always tell its own name, so the Worker says which one it asked.
            const shard = url.searchParams.get("shard") ?? "";
            if (/^\d{1,4}$/.test(shard)) this.#shard = Number(shard);
            return json(this.core.status(this.#shard));
        }
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return refuse("upgrade_required", 426, { upgrade: "websocket" });
        }
        const channel = normaliseChannel(url.searchParams.get("channel"));
        if (!channel) return refuse("invalid_channel", 400);
        const refusal = this.core.refusal(channel);
        if (refusal) {
            return refuse(refusal, 503, { "retry-after": String(this.core.retryAfter()) });
        }

        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        try {
            await this.core.accepted(pair[1], channel);
        } catch {
            // Answered with the upgrade all the same: only an open socket can carry the code
            // that tells the overlay what happened.
            pair[1].close(CLOSE_INTERNAL, "internal error");
        }
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
        await this.core.message(socket, message);
    }

    async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
        await this.core.closed(socket);
        try {
            // Without the answer the overlay's side stays half closed until it gives up, and
            // the runtime keeps the socket that long. Codes such as 1005 and 1006 report
            // what happened and cannot be sent.
            if (SENDABLE_CLOSE.has(code) || (code >= 3000 && code <= 4999)) {
                socket.close(code, reason);
            } else {
                socket.close(CLOSE_NORMAL);
            }
        } catch {
            // Closed from this side before, or the connection is gone.
        }
    }

    async webSocketError(socket: WebSocket): Promise<void> {
        await this.core.closed(socket);
    }

    async alarm(): Promise<void> {
        await this.core.alarm();
    }

    /** The row `hub-tick` of `analytics.ts`: the shard, then the counters in this order. */
    #report(tick: HubTick): void {
        record(this.env, {
            event: "hub-tick",
            values: [
                this.#shard ?? -1,
                tick.clients,
                tick.channels,
                tick.upstreamConnections,
                tick.joinedChannels,
                tick.lines,
                tick.accepted,
                tick.refused,
                tick.upstreamFailures,
            ],
        });
    }

    /**
     * The row `hub-paused` of `analytics.ts`, and the one line the hub ever writes to the log.
     * A reason, a shard and two counts: nothing that names a channel.
     */
    #paused(pause: PauseStart): void {
        const shard = this.#shard ?? -1;
        console.warn("hub paused itself", { ...pause, shard });
        record(this.env, {
            event: "hub-paused",
            labels: [pause.reason],
            values: [shard, pause.measured, pause.threshold],
        });
    }

    #resumed(reason: PauseReason): void {
        record(this.env, { event: "hub-resumed", labels: [reason], values: [this.#shard ?? -1] });
    }
}
