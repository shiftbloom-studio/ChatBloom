import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    GATEWAY_PREFIXES,
    GATEWAY_ROUTES,
    matchRoute,
    slimSevenTVSet,
    slimSevenTVUser,
} from "../../../src/worker/gateway/routes";

/** Turns a provider URL into the gateway request the client would send instead. */
function viaGateway(providerUrl: string): { path: string; query: URLSearchParams } {
    for (const [base, prefix] of Object.entries(GATEWAY_PREFIXES)) {
        if (!providerUrl.startsWith(base)) continue;
        const url = new URL(prefix + providerUrl.slice(base.length), "https://chat.example");
        return { path: url.pathname, query: url.searchParams };
    }
    throw new Error(`no gateway prefix for ${providerUrl}`);
}

/**
 * Every request of src/lib/chat/providers, with the ids the client would put in. That the
 * client sends exactly these is checked in client.test.ts.
 */
const CLIENT_REQUESTS: [method: string, url: string, route: string, key: string][] = [
    ["GET", "https://7tv.io/v3/emote-sets/global", "7tv.global", "7tv.global"],
    [
        "GET",
        "https://7tv.io/v3/emote-sets/01FKX5Q4VG0004X8QJ9S80KD58",
        "7tv.set",
        "7tv.set:01FKX5Q4VG0004X8QJ9S80KD58",
    ],
    [
        "GET",
        "https://7tv.io/v3/emote-sets/60ae3e54259ac5a73e56a426",
        "7tv.set",
        "7tv.set:60ae3e54259ac5a73e56a426",
    ],
    ["GET", "https://7tv.io/v3/users/twitch/50985620", "7tv.user", "7tv.user:50985620"],
    ["POST", "https://7tv.io/v4/gql", "7tv.paints", "7tv.paints"],
    ["GET", "https://api.betterttv.net/3/cached/emotes/global", "bttv.global", "bttv.global"],
    [
        "GET",
        "https://api.betterttv.net/3/cached/users/twitch/50985620",
        "bttv.user",
        "bttv.user:50985620",
    ],
    ["GET", "https://api.betterttv.net/3/cached/badges/twitch", "bttv.badges", "bttv.badges"],
    ["GET", "https://api.frankerfacez.com/v1/set/global", "ffz.global", "ffz.global"],
    ["GET", "https://api.frankerfacez.com/v1/room/id/50985620", "ffz.room", "ffz.room:50985620"],
    ["GET", "https://api.frankerfacez.com/v1/badges/ids", "ffz.badges", "ffz.badges"],
    ["GET", "https://api.ffzap.com/v1/supporters", "ffzap.supporters", "ffzap.supporters"],
    ["GET", "https://api.chatterino.com/badges", "chatterino.badges", "chatterino.badges"],
    ["GET", "https://api.ivr.fi/v2/twitch/badges/global", "ivr.badges.global", "ivr.badges.global"],
    [
        "GET",
        "https://api.ivr.fi/v2/twitch/badges/channel?id=50985620",
        "ivr.badges.channel",
        "ivr.badges.channel:50985620",
    ],
];

describe("allowlist", () => {
    it("routes every request the client makes back to the URL it came from", () => {
        for (const [method, url, routeId, key] of CLIENT_REQUESTS) {
            const { path, query } = viaGateway(url);
            const match = matchRoute(method, path, query);
            assert.ok(typeof match !== "string", `${url} was refused: ${String(match)}`);
            assert.equal(match.route.id, routeId);
            assert.equal(match.key, key);
            assert.equal(match.route.upstream(match.params), url);
        }
    });

    it("covers every route with a client request", () => {
        const covered = new Set(CLIENT_REQUESTS.map(([, , route]) => route));
        assert.deepEqual(
            GATEWAY_ROUTES.map((route) => route.id).filter((id) => !covered.has(id)),
            [],
        );
    });

    it("only ever asks the six providers over HTTPS", () => {
        const hosts = new Set(
            CLIENT_REQUESTS.map(([method, url]) => {
                const { path, query } = viaGateway(url);
                const match = matchRoute(method, path, query);
                assert.ok(typeof match !== "string");
                const upstream = new URL(match.route.upstream(match.params));
                assert.equal(upstream.protocol, "https:");
                return upstream.host;
            }),
        );
        assert.deepEqual([...hosts].sort(), [
            "7tv.io",
            "api.betterttv.net",
            "api.chatterino.com",
            "api.ffzap.com",
            "api.frankerfacez.com",
            "api.ivr.fi",
        ]);
    });

    it("refuses everything else", () => {
        const none = new URLSearchParams();
        const refused: [string, string, URLSearchParams, string][] = [
            ["GET", "/", none, "unsupported_route"],
            ["GET", "/7tv", none, "unsupported_route"],
            ["GET", "/7tv/v3/emote-sets/global/", none, "unsupported_route"],
            ["GET", "/7tv/v3/emotes/01FKX5Q4VG0004X8QJ9S80KD58", none, "unsupported_route"],
            ["GET", "/7tv/v3/users/twitch/papaplatte", none, "unsupported_route"],
            ["GET", "/7tv/v3/users/twitch/050985620", none, "unsupported_route"],
            ["GET", "/7tv/v3/users/twitch/0", none, "unsupported_route"],
            ["GET", "/7tv/v3/users/twitch/12345678901234567", none, "unsupported_route"],
            ["GET", "/7tv/v3/users/youtube/50985620", none, "unsupported_route"],
            // 7TV reads lowercase ULIDs as the same set; one spelling keeps one cache entry.
            ["GET", "/7tv/v3/emote-sets/01fkx5q4vg0004x8qj9s80kd58", none, "unsupported_route"],
            ["GET", "/7tv/v3/emote-sets/01FKX5Q4VG0004X8QJ9S80KD5", none, "unsupported_route"],
            ["GET", "/7tv/v3/emote-sets/01FKX5Q4VG0004X8QJ9S80KD58X", none, "unsupported_route"],
            ["GET", "/7tv/v3/emote-sets/%67lobal", none, "unsupported_route"],
            ["GET", "/bttv/3/cached/users/twitch/1/../../emotes/global", none, "unsupported_route"],
            ["GET", "/bttv/3/cached/users/twitch/1%2F..", none, "unsupported_route"],
            ["GET", "/bttv/3/cached/users/youtube/1", none, "unsupported_route"],
            ["GET", "/ffz/v1/room/papaplatte", none, "unsupported_route"],
            ["GET", "/ffz/v1/room/id/50985620\n", none, "unsupported_route"],
            ["GET", "/ffzap/v1/user/badge/50985620/1", none, "unsupported_route"],
            [
                "GET",
                "/ivr/v2/twitch/user",
                new URLSearchParams("login=papaplatte"),
                "unsupported_route",
            ],
            ["GET", "/twitch/helix/users", none, "unsupported_route"],
            ["GET", "//7tv.io/v3/emote-sets/global", none, "unsupported_route"],
            ["GET", "/7tv/v3/emote-sets/global", new URLSearchParams("x=1"), "invalid_query"],
            ["GET", "/ivr/v2/twitch/badges/channel", none, "invalid_query"],
            [
                "GET",
                "/ivr/v2/twitch/badges/channel",
                new URLSearchParams("id=abc"),
                "invalid_query",
            ],
            [
                "GET",
                "/ivr/v2/twitch/badges/channel",
                new URLSearchParams("id=1&id=2"),
                "invalid_query",
            ],
            [
                "GET",
                "/ivr/v2/twitch/badges/channel",
                new URLSearchParams("id=1&x=2"),
                "invalid_query",
            ],
            [
                "GET",
                "/ivr/v2/twitch/badges/channel",
                new URLSearchParams("login=x"),
                "invalid_query",
            ],
            ["POST", "/7tv/v3/emote-sets/global", none, "method_not_allowed"],
            ["GET", "/7tv/v4/gql", none, "method_not_allowed"],
            ["DELETE", "/bttv/3/cached/emotes/global", none, "method_not_allowed"],
            ["HEAD", "/bttv/3/cached/emotes/global", none, "method_not_allowed"],
        ];
        for (const [method, path, query, reason] of refused) {
            assert.equal(matchRoute(method, path, query), reason, `${method} ${path}?${query}`);
        }
    });

    it("keeps keys far below the 512 bytes KV allows", () => {
        for (const [method, url] of CLIENT_REQUESTS) {
            const { path, query } = viaGateway(url);
            const match = matchRoute(method, path, query);
            assert.ok(typeof match !== "string");
            assert.ok(`d1:${match.key}`.length <= 64);
        }
    });

    it("has policies KV can hold and that never serve stale longer than they keep", () => {
        for (const { id, policy } of GATEWAY_ROUTES) {
            assert.ok(policy.fresh >= 60, `${id} is fresh for less than KV's visibility delay`);
            assert.ok(policy.staleWhileRevalidate <= policy.staleIfError, id);
            assert.ok(policy.maxBytes <= 25 * 1024 * 1024, `${id} exceeds the KV value limit`);
        }
    });
});

describe("7TV payload trimming", () => {
    const set = {
        id: "01FKX5Q4VG0004X8QJ9S80KD58",
        name: "Emotes",
        flags: 0,
        tags: [],
        capacity: 1000,
        owner: { id: "owner", username: "someone", roles: ["a"] },
        emotes: [
            {
                id: "01F01APK500007E4VV006YKSMR",
                name: "xqcL",
                flags: 1,
                timestamp: 1614952484000,
                actor_id: null,
                data: {
                    id: "01F01APK500007E4VV006YKSMR",
                    name: "xqcL",
                    flags: 0,
                    lifecycle: 3,
                    listed: true,
                    animated: true,
                    owner: { id: "uploader", username: "uploader", role_ids: ["x", "y"] },
                    host: {
                        url: "//cdn.7tv.app/emote/01F01APK500007E4VV006YKSMR",
                        files: [
                            {
                                name: "1x.webp",
                                static_name: "1x_static.webp",
                                width: 32,
                                height: 32,
                                frame_count: 68,
                                size: 56022,
                                format: "WEBP",
                            },
                            {
                                name: "1x.avif",
                                static_name: "1x_static.avif",
                                width: 32,
                                height: 32,
                                frame_count: 68,
                                size: 30104,
                                format: "AVIF",
                            },
                        ],
                    },
                },
            },
            { id: "deleted", name: "Gone", flags: 0, data: null },
        ],
    };

    it("keeps exactly what the client reads", () => {
        assert.deepEqual(slimSevenTVSet(set), {
            id: "01FKX5Q4VG0004X8QJ9S80KD58",
            name: "Emotes",
            flags: 0,
            emotes: [
                {
                    id: "01F01APK500007E4VV006YKSMR",
                    name: "xqcL",
                    flags: 1,
                    data: {
                        id: "01F01APK500007E4VV006YKSMR",
                        name: "xqcL",
                        flags: 0,
                        animated: true,
                        host: {
                            url: "//cdn.7tv.app/emote/01F01APK500007E4VV006YKSMR",
                            files: [{ name: "1x.webp", width: 32, height: 32, format: "WEBP" }],
                        },
                    },
                },
                { id: "deleted", name: "Gone", flags: 0, data: null },
            ],
        });
    });

    it("keeps the broadcaster's 7TV id and copes with a channel without a set", () => {
        const user = { id: "u1", username: "someone", editors: [{ id: "e" }] };
        assert.deepEqual(slimSevenTVUser({ id: "1", emote_set_id: null, emote_set: null, user }), {
            id: "1",
            emote_set_id: null,
            emote_set: null,
            user: { id: "u1" },
        });
        const slim = slimSevenTVUser({ id: "1", emote_set_id: set.id, emote_set: set, user }) as {
            emote_set: { emotes: unknown[] };
        };
        assert.equal(slim.emote_set.emotes.length, 2);
    });

    it("copes with a set that has no emotes", () => {
        assert.deepEqual(slimSevenTVSet({ id: "a", name: "b", flags: 4, emotes: null }), {
            id: "a",
            name: "b",
            flags: 4,
            emotes: [],
        });
    });
});
