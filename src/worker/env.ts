import type { ChatHub } from "./hub";

/**
 * Bindings and variables of the Worker, as declared in `wrangler.jsonc`. The Durable Object
 * gets the same object. Everything except `CHAT_HUB` is optional: a deployment without the
 * cache, the counters or the rate limits still serves chat.
 */
export interface Env {
    /** Static assets; set by the build, absent only in unit tests. */
    ASSETS?: Fetcher;
    CHAT_HUB: DurableObjectNamespace<ChatHub>;
    /** Cache of the data gateway. */
    CACHE?: KVNamespace;
    /** Counters only; written through `analytics.ts`. */
    ANALYTICS?: AnalyticsEngineDataset;
    /** Per client address; asked through `rate-limit.ts`. */
    RATE_LIMIT?: RateLimit;
    /** Tighter limit for gateway requests of which nothing is stored yet. */
    RATE_LIMIT_MISS?: RateLimit;
    CF_VERSION_METADATA?: WorkerVersionMetadata;

    /**
     * `false` switches the relay off: `/api/irc` answers 503 at once and overlays use their
     * direct connection. This is the emergency exit, since a deployment that introduced the
     * Durable Object cannot be rolled back.
     */
    RELAY_ENABLED?: string;
    /** Number of hub shards, as a decimal string. */
    RELAY_SHARDS?: string;
    /** Upstream IRC endpoint; tests point it at a mock server. */
    TWITCH_IRC_URL?: string;

    /** Tuning of the hub, all decimal strings; `hub.ts` says what each one defaults to. */
    MAX_CHANNELS_PER_UPSTREAM?: string;
    MAX_CLIENTS_PER_HUB?: string;
    MAX_CHANNELS_PER_HUB?: string;
    REPLAY_LINES?: string;
    PART_GRACE_MS?: string;
    WATCHDOG_MS?: string;

    /**
     * The safety switch, all decimal strings: a hub that counts more than one of the first
     * four pauses itself for `RELAY_PAUSE_MINUTES`, and `0` switches a threshold off.
     */
    RELAY_PAUSE_CLIENTS?: string;
    RELAY_PAUSE_CHANNELS?: string;
    RELAY_PAUSE_CONNECTS_PER_MINUTE?: string;
    RELAY_PAUSE_LINES_PER_MINUTE?: string;
    RELAY_PAUSE_FRAMES_PER_MINUTE?: string;
    RELAY_PAUSE_MINUTES?: string;
}
