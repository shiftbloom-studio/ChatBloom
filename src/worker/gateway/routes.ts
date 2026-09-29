/**
 * The allowlist of the provider data gateway: every REST call the chat client makes today, and
 * nothing else. A request that matches no route is refused, so the gateway can never be used as
 * an open proxy.
 */

/** All durations are in seconds. */
export interface CachePolicy {
    /** How long a stored answer is served without asking the provider. */
    fresh: number;
    /**
     * Window after `fresh` in which the stored answer is served at once and refreshed in the
     * background. Zero for channel data: an overlay reload must show emotes added a minute ago.
     */
    staleWhileRevalidate: number;
    /** Window after `fresh` in which the stored answer is served when the provider fails. */
    staleIfError: number;
    /**
     * How long an upstream 404 ("no account here") is trusted. Absent on lists that always
     * exist, where a 404 is a provider fault and must not replace the stored list.
     */
    negativeFresh?: number;
    /** Upstream bodies above this size are refused rather than stored. */
    maxBytes: number;
}

export interface GatewayRoute {
    /** Stable name: part of the cache key and the only route detail written to analytics. */
    id: string;
    provider: "7tv" | "bttv" | "ffz" | "ffzap" | "chatterino" | "ivr";
    method: "GET" | "POST";
    /** Matched against the path behind `/api/data`; named groups become parameters. */
    path: RegExp;
    /** Query parameters, all required. Any parameter not listed here refuses the request. */
    query?: Record<string, RegExp>;
    upstream: (params: Record<string, string>) => string;
    policy: CachePolicy;
    /**
     * Shrinks the provider's answer to what the client reads before it is stored. Throws when
     * the answer does not have the expected shape, which counts as a provider failure.
     */
    transform?: (json: unknown) => unknown;
}

const KIB = 1024;
const MIB = 1024 * KIB;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Twitch user ids are decimal; leading zeros are refused so one room has one cache key. */
const TWITCH_ID = "[1-9][0-9]{0,15}";
/** 7TV ids are ULIDs; ids from before its 2024 migration are 24 hex digits and still parse. */
const SEVENTV_ID = "[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{24}";

export const SEVENTV_ID_PATTERN = new RegExp(`^(?:${SEVENTV_ID})$`);

/** Lists shared by every overlay: changed rarely, so served instantly and refreshed behind. */
const sharedList = (fresh: number, maxBytes: number): CachePolicy => ({
    fresh,
    staleWhileRevalidate: Math.max(HOUR, 4 * fresh),
    staleIfError: 7 * DAY,
    maxBytes,
});

/** Data of one channel: short-lived, but kept for a week in case the provider is down. */
const channelData = (fresh: number, negativeFresh: number, maxBytes: number): CachePolicy => ({
    fresh,
    staleWhileRevalidate: 0,
    staleIfError: 7 * DAY,
    negativeFresh,
    maxBytes,
});

interface SevenTVFile {
    name: string;
    width: number;
    height: number;
    format: string;
}

interface SevenTVSetPayload {
    id: string;
    name: string;
    flags: number;
    emotes?:
        | {
              id: string;
              name: string;
              flags: number;
              data?: {
                  id: string;
                  name: string;
                  flags: number;
                  animated: boolean;
                  host: { url: string; files: SevenTVFile[] };
              } | null;
          }[]
        | null;
}

/**
 * 7TV repeats the uploader's whole profile and every AVIF rendition with each emote: a full
 * channel set weighs 2.4 MB, of which the overlay reads a fifth.
 */
export function slimSevenTVSet(json: unknown): unknown {
    const set = json as SevenTVSetPayload;
    if (typeof set.id !== "string" || (set.emotes != null && !Array.isArray(set.emotes))) {
        throw new TypeError("not a 7TV emote set");
    }
    return {
        id: set.id,
        name: set.name,
        flags: set.flags,
        emotes: (set.emotes ?? []).map((active) => ({
            id: active.id,
            name: active.name,
            flags: active.flags,
            data: active.data
                ? {
                      id: active.data.id,
                      name: active.data.name,
                      flags: active.data.flags,
                      animated: active.data.animated,
                      host: {
                          url: active.data.host.url,
                          files: active.data.host.files
                              .filter((file) => file.format === "WEBP")
                              .map(({ name, width, height, format }) => ({
                                  name,
                                  width,
                                  height,
                                  format,
                              })),
                      },
                  }
                : null,
        })),
    };
}

export function slimSevenTVUser(json: unknown): unknown {
    const connection = json as {
        id: string;
        emote_set_id: string | null;
        emote_set: SevenTVSetPayload | null;
        user?: { id: string };
    };
    if (typeof connection.user?.id !== "string") throw new TypeError("not a 7TV connection");
    return {
        id: connection.id,
        emote_set_id: connection.emote_set_id,
        emote_set: connection.emote_set ? slimSevenTVSet(connection.emote_set) : null,
        user: { id: connection.user.id },
    };
}

/** Matches `/api/data/7tv/v4/gql`; its body is handled by the paints code, not proxied. */
export const PAINTS_ROUTE_ID = "7tv.paints";

export const GATEWAY_ROUTES: readonly GatewayRoute[] = [
    {
        id: "7tv.global",
        provider: "7tv",
        method: "GET",
        path: /^\/7tv\/v3\/emote-sets\/global$/,
        upstream: () => "https://7tv.io/v3/emote-sets/global",
        policy: sharedList(10 * MINUTE, 2 * MIB),
        transform: slimSevenTVSet,
    },
    {
        id: "7tv.set",
        provider: "7tv",
        method: "GET",
        path: new RegExp(`^/7tv/v3/emote-sets/(?<setId>${SEVENTV_ID})$`),
        upstream: ({ setId }) => `https://7tv.io/v3/emote-sets/${setId}`,
        // Fetched right after a change event, and personal sets are many: fresh for a minute
        // only, and gone after a day.
        policy: { ...channelData(MINUTE, MINUTE, 8 * MIB), staleIfError: DAY },
        transform: slimSevenTVSet,
    },
    {
        id: "7tv.user",
        provider: "7tv",
        method: "GET",
        path: new RegExp(`^/7tv/v3/users/twitch/(?<twitchId>${TWITCH_ID})$`),
        upstream: ({ twitchId }) => `https://7tv.io/v3/users/twitch/${twitchId}`,
        policy: channelData(MINUTE, 2 * MINUTE, 8 * MIB),
        transform: slimSevenTVUser,
    },
    {
        id: PAINTS_ROUTE_ID,
        provider: "7tv",
        method: "POST",
        path: /^\/7tv\/v4\/gql$/,
        upstream: () => "https://7tv.io/v4/gql",
        // Per paint, not per request. Paint definitions practically never change.
        policy: {
            fresh: DAY,
            staleWhileRevalidate: 7 * DAY,
            staleIfError: 30 * DAY,
            negativeFresh: 5 * MINUTE,
            maxBytes: MIB,
        },
    },
    {
        id: "bttv.global",
        provider: "bttv",
        method: "GET",
        path: /^\/bttv\/3\/cached\/emotes\/global$/,
        upstream: () => "https://api.betterttv.net/3/cached/emotes/global",
        policy: sharedList(10 * MINUTE, MIB),
    },
    {
        id: "bttv.user",
        provider: "bttv",
        method: "GET",
        path: new RegExp(`^/bttv/3/cached/users/twitch/(?<twitchId>${TWITCH_ID})$`),
        upstream: ({ twitchId }) => `https://api.betterttv.net/3/cached/users/twitch/${twitchId}`,
        policy: channelData(2 * MINUTE, 2 * MINUTE, 2 * MIB),
    },
    {
        id: "bttv.badges",
        provider: "bttv",
        method: "GET",
        path: /^\/bttv\/3\/cached\/badges\/twitch$/,
        upstream: () => "https://api.betterttv.net/3/cached/badges/twitch",
        policy: sharedList(15 * MINUTE, MIB),
    },
    {
        id: "ffz.global",
        provider: "ffz",
        method: "GET",
        path: /^\/ffz\/v1\/set\/global$/,
        upstream: () => "https://api.frankerfacez.com/v1/set/global",
        policy: sharedList(10 * MINUTE, MIB),
    },
    {
        id: "ffz.room",
        provider: "ffz",
        method: "GET",
        path: new RegExp(`^/ffz/v1/room/id/(?<twitchId>${TWITCH_ID})$`),
        upstream: ({ twitchId }) => `https://api.frankerfacez.com/v1/room/id/${twitchId}`,
        policy: channelData(2 * MINUTE, 2 * MINUTE, 2 * MIB),
    },
    {
        id: "ffz.badges",
        provider: "ffz",
        method: "GET",
        path: /^\/ffz\/v1\/badges\/ids$/,
        upstream: () => "https://api.frankerfacez.com/v1/badges/ids",
        policy: sharedList(15 * MINUTE, 4 * MIB),
    },
    {
        id: "ffzap.supporters",
        provider: "ffzap",
        method: "GET",
        path: /^\/ffzap\/v1\/supporters$/,
        upstream: () => "https://api.ffzap.com/v1/supporters",
        policy: sharedList(30 * MINUTE, MIB),
    },
    {
        id: "chatterino.badges",
        provider: "chatterino",
        method: "GET",
        path: /^\/chatterino\/badges$/,
        upstream: () => "https://api.chatterino.com/badges",
        policy: sharedList(HOUR, MIB),
    },
    {
        id: "ivr.badges.global",
        provider: "ivr",
        method: "GET",
        path: /^\/ivr\/v2\/twitch\/badges\/global$/,
        upstream: () => "https://api.ivr.fi/v2/twitch/badges/global",
        policy: sharedList(HOUR, 2 * MIB),
    },
    {
        id: "ivr.badges.channel",
        provider: "ivr",
        method: "GET",
        path: /^\/ivr\/v2\/twitch\/badges\/channel$/,
        query: { id: new RegExp(`^(?:${TWITCH_ID})$`) },
        upstream: ({ id }) => `https://api.ivr.fi/v2/twitch/badges/channel?id=${id}`,
        policy: channelData(10 * MINUTE, 5 * MINUTE, MIB),
    },
];

/** Provider base URLs the client uses, mapped to their gateway prefix behind `/api/data`. */
export const GATEWAY_PREFIXES: Readonly<Record<string, string>> = {
    "https://7tv.io/": "/7tv/",
    "https://api.betterttv.net/": "/bttv/",
    "https://api.frankerfacez.com/": "/ffz/",
    "https://api.ffzap.com/": "/ffzap/",
    "https://api.chatterino.com/": "/chatterino/",
    "https://api.ivr.fi/": "/ivr/",
};

export interface RouteMatch {
    route: GatewayRoute;
    params: Record<string, string>;
    /** Cache key without the schema prefix, e.g. `7tv.user:50985620`. */
    key: string;
}

export type RouteRefusal = "unsupported_route" | "method_not_allowed" | "invalid_query";

/**
 * Resolves a gateway request to its route. `path` is the URL path behind `/api/data`, taken
 * undecoded from the URL: an escaped character can therefore never match a pattern.
 */
export function matchRoute(
    method: string,
    path: string,
    query: URLSearchParams,
): RouteMatch | RouteRefusal {
    let refusal: RouteRefusal = "unsupported_route";
    for (const route of GATEWAY_ROUTES) {
        const match = route.path.exec(path);
        if (!match) continue;
        if (route.method !== method) {
            refusal = "method_not_allowed";
            continue;
        }
        const params: Record<string, string> = { ...match.groups };
        const expected = Object.entries(route.query ?? {});
        const names = [...query.keys()];
        if (names.length !== expected.length) return "invalid_query";
        for (const [name, pattern] of expected) {
            const value = query.get(name);
            if (value === null || !pattern.test(value)) return "invalid_query";
            params[name] = value;
        }
        const values = Object.values(params);
        return { route, params, key: [route.id, ...values].join(":") };
    }
    return refusal;
}
