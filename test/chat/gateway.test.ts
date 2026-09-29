import assert from "node:assert/strict";
import { afterEach, describe, it, type TestContext } from "node:test";

import { fetchJson, GATEWAY_PREFIXES, gatewayUrl } from "../../src/lib/chat/gateway";
import {
    fetchBTTVBadges,
    fetchBTTVChannelEmotes,
    fetchBTTVGlobalEmotes,
} from "../../src/lib/chat/providers/bttv";
import { fetchChatterinoBadges } from "../../src/lib/chat/providers/chatterino";
import {
    fetchFFZAPBadges,
    fetchFFZBadges,
    fetchFFZGlobal,
    fetchFFZRoom,
} from "../../src/lib/chat/providers/ffz";
import {
    fetchSevenTVChannel,
    fetchSevenTVEmoteSet,
    fetchSevenTVGlobalEmotes,
    fetchSevenTVPaints,
} from "../../src/lib/chat/providers/seventv/api";
import {
    fetchTwitchChannelBadges,
    fetchTwitchGlobalBadges,
} from "../../src/lib/chat/providers/twitch";
import { parsePaintsRequest } from "../../src/worker/gateway/paints";
import {
    GATEWAY_ROUTES,
    GATEWAY_PREFIXES as WORKER_PREFIXES,
} from "../../src/worker/gateway/routes";
import { type FetchAnswer, stubFetch, useLocation } from "../helpers";

const ORIGIN = "https://chat.shiftbloom.studio";
const OVERLAY = `${ORIGIN}/chat/forsen`;
const PROVIDER = "https://api.betterttv.net/3/cached/users/twitch/1";
const GATEWAY = `${ORIGIN}/api/data/bttv/3/cached/users/twitch/1`;
const ANSWER = { channelEmotes: [], sharedEmotes: [] };

let restoreFetch = () => {};
let restoreLocation = () => {};
afterEach(() => {
    restoreFetch();
    restoreLocation();
    restoreFetch = restoreLocation = () => {};
});

/** Every answer of the gateway carries this header, whatever its status. */
const gateway =
    (body: unknown, status = 200): FetchAnswer =>
    () =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "x-petal-cache": status < 400 ? "HIT; layer=memory" : "ERROR" },
        });

const unreachable: FetchAnswer = () => {
    throw new TypeError("Failed to fetch");
};

/** Never answers, and fails like fetch() does once the request is aborted. */
const hangs: FetchAnswer = (init) =>
    new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });

function stub(t: TestContext, routes: Record<string, unknown>, page = OVERLAY) {
    restoreLocation = useLocation(page);
    const fetches = stubFetch(routes);
    restoreFetch = fetches;
    const warn = t.mock.method(console, "warn", () => {});
    return { asked: () => fetches.calls.map((call) => call.url), calls: fetches.calls, warn };
}

describe("gatewayUrl", () => {
    it("mirrors the prefixes of the Worker's gateway", () => {
        assert.deepEqual(
            GATEWAY_PREFIXES,
            Object.fromEntries(
                Object.entries(WORKER_PREFIXES).map(([base, prefix]) => [
                    base,
                    `/api/data${prefix}`,
                ]),
            ),
        );
    });

    it("keeps the provider's path and query behind the prefix", () => {
        restoreLocation = useLocation(OVERLAY);
        assert.equal(gatewayUrl(PROVIDER), GATEWAY);
        assert.equal(
            gatewayUrl("https://api.ivr.fi/v2/twitch/badges/channel?id=7"),
            `${ORIGIN}/api/data/ivr/v2/twitch/badges/channel?id=7`,
        );
        assert.equal(gatewayUrl("https://7tv.io/v4/gql"), `${ORIGIN}/api/data/7tv/v4/gql`);
        assert.equal(gatewayUrl("https://cdn.7tv.app/emote/1/1x.webp"), undefined);
        assert.equal(gatewayUrl("https://7tv.io.example.com/v3/emote-sets/global"), undefined);
    });

    it("knows no gateway without a page served over http(s), or with ?direct=1", () => {
        assert.equal(gatewayUrl(PROVIDER), undefined);
        for (const page of [`${OVERLAY}?direct=1`, "file:///C:/overlays/chat.html"]) {
            const restore = useLocation(page);
            assert.equal(gatewayUrl(PROVIDER), undefined, page);
            restore();
        }
    });
});

describe("fetchJson", () => {
    it("asks the gateway and not the provider", async (t) => {
        const { asked, warn } = stub(t, { [GATEWAY]: gateway(ANSWER) });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY]);
        assert.equal(warn.mock.callCount(), 0);
    });

    it("takes a 404 from the gateway as the provider's answer", async (t) => {
        const { asked, warn } = stub(t, { [GATEWAY]: gateway({ error: "not found" }, 404) });
        assert.equal(await fetchJson(PROVIDER), undefined);
        assert.deepEqual(asked(), [GATEWAY]);
        assert.equal(warn.mock.callCount(), 0);
    });

    it("asks the provider when the gateway cannot be reached", async (t) => {
        const { asked, warn } = stub(t, { [GATEWAY]: unreachable, [PROVIDER]: ANSWER });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
        assert.equal(warn.mock.callCount(), 1);
    });

    for (const status of [429, 500, 502, 503]) {
        it(`asks the provider when the gateway answers ${status}`, async (t) => {
            const { asked } = stub(t, {
                [GATEWAY]: gateway({ error: "upstream_failed" }, status),
                [PROVIDER]: ANSWER,
            });
            assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
            assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
        });
    }

    it("asks the provider when the Worker refuses before the gateway is reached", async (t) => {
        // A rate limit in front of the Worker answers without the gateway's header.
        const { asked } = stub(t, { [GATEWAY]: 429, [PROVIDER]: ANSWER });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("asks the provider when the gateway refuses the request", async (t) => {
        const { asked } = stub(t, {
            [GATEWAY]: gateway({ error: "unsupported_route" }, 400),
            [PROVIDER]: ANSWER,
        });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("asks the provider when something else than the gateway answers", async (t) => {
        // A deployment without the gateway renders its 404 page for the path.
        const { asked } = stub(t, { [GATEWAY]: 404, [PROVIDER]: ANSWER });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("asks the provider when the gateway's answer cannot be read", async (t) => {
        const page: FetchAnswer = () =>
            new Response("<!doctype html>", { headers: { "x-petal-cache": "HIT" } });
        const { asked } = stub(t, { [GATEWAY]: page, [PROVIDER]: ANSWER });
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("asks the provider when the gateway has not answered after 8 seconds", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { asked } = stub(t, { [GATEWAY]: hangs, [PROVIDER]: ANSWER });
        const settled = () => new Promise((resolve) => setImmediate(resolve));
        const result = fetchJson(PROVIDER);
        t.mock.timers.tick(7999);
        await settled();
        assert.deepEqual(asked(), [GATEWAY]);

        t.mock.timers.tick(1);
        await settled();
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
        assert.deepEqual(await result, ANSWER);
    });

    it("gives the direct request no deadline", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { calls } = stub(t, { [GATEWAY]: gateway({}, 503), [PROVIDER]: ANSWER });
        await fetchJson(PROVIDER);
        assert.ok(calls[0].init?.signal);
        assert.equal(calls[1].init?.signal, undefined);
    });

    it("reports the provider's failure when both fail", async (t) => {
        const { asked } = stub(t, { [GATEWAY]: gateway({}, 502), [PROVIDER]: 500 });
        await assert.rejects(fetchJson(PROVIDER), new RegExp(`${PROVIDER} answered 500`));
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("takes a 404 from the provider as its answer after the gateway failed", async (t) => {
        const { asked } = stub(t, { [GATEWAY]: gateway({}, 503), [PROVIDER]: 404 });
        assert.equal(await fetchJson(PROVIDER), undefined);
        assert.deepEqual(asked(), [GATEWAY, PROVIDER]);
    });

    it("asks the provider only with ?direct=1", async (t) => {
        const { asked } = stub(t, { [PROVIDER]: ANSWER }, `${OVERLAY}?direct=1`);
        assert.deepEqual(await fetchJson(PROVIDER), ANSWER);
        assert.deepEqual(asked(), [PROVIDER]);
    });
});

describe("provider requests", () => {
    const PAINT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const SET = "01J8ZQ4Y7N0000000000000000";

    /** Answers every gateway request like the gateway would for a provider without data. */
    function recordGateway(t: TestContext) {
        restoreLocation = useLocation(OVERLAY);
        const requests: { method: string; url: URL; init: RequestInit | undefined }[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (input: string, init?: RequestInit) => {
            requests.push({ method: init?.method ?? "GET", url: new URL(input), init });
            return new Response('{"data":{"paints":{"p0":null}}}', {
                status: init?.method === "POST" ? 200 : 404,
                headers: { "x-petal-cache": "MISS; layer=upstream" },
            });
        }) as typeof fetch;
        restoreFetch = () => {
            globalThis.fetch = original;
        };
        t.mock.method(console, "warn", () => {});
        return requests;
    }

    it("all pass the allowlist of the Worker's gateway", async (t) => {
        const requests = recordGateway(t);
        await Promise.all([
            fetchSevenTVGlobalEmotes(),
            fetchSevenTVEmoteSet(SET),
            fetchSevenTVEmoteSet("60ae958e229664e8667aea38"),
            fetchSevenTVChannel("22484632"),
            fetchSevenTVPaints([PAINT]),
            fetchBTTVGlobalEmotes(),
            fetchBTTVChannelEmotes("22484632"),
            fetchBTTVBadges(),
            fetchFFZGlobal(),
            fetchFFZRoom("22484632"),
            fetchFFZBadges(),
            fetchFFZAPBadges(),
            fetchChatterinoBadges(),
            fetchTwitchGlobalBadges(),
            fetchTwitchChannelBadges("22484632"),
        ]);
        assert.equal(requests.length, 15);

        const used = new Set<string>();
        for (const { method, url } of requests) {
            assert.equal(url.origin, ORIGIN);
            assert.ok(url.pathname.startsWith("/api/data/"), url.pathname);
            const path = url.pathname.slice("/api/data".length);
            const route = GATEWAY_ROUTES.find(
                (candidate) => candidate.method === method && candidate.path.test(path),
            );
            assert.ok(route, `${method} ${path} matches no route`);
            const query = Object.entries(route.query ?? {});
            assert.deepEqual([...url.searchParams.keys()], Object.keys(route.query ?? {}), path);
            for (const [name, pattern] of query) {
                assert.match(url.searchParams.get(name) ?? "", pattern, path);
            }
            used.add(route.id);
        }
        assert.deepEqual(
            GATEWAY_ROUTES.map((route) => route.id).filter((id) => !used.has(id)),
            [],
            "every route of the gateway is one the client uses",
        );
    });

    it("send the 7TV paints query in the shape the gateway reads", async (t) => {
        const requests = recordGateway(t);
        const ids = [PAINT, "01J8ZQ4Y7N0000000000000001"];
        assert.deepEqual(await fetchSevenTVPaints(ids), []);

        const [{ method, url, init }] = requests;
        assert.equal(method, "POST");
        assert.equal(url.href, `${ORIGIN}/api/data/7tv/v4/gql`);
        assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
        assert.deepEqual(parsePaintsRequest(String(init?.body)), ids);
    });
});
