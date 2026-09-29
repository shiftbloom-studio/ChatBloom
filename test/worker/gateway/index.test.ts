import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { type GatewayEnv, type GatewayEvent, handleData } from "../../../src/worker/gateway/index";
import { FakeKV, jsonResponse } from "./fakes";

const BTTV_USER = "https://api.betterttv.net/3/cached/users/twitch/";
const CLIENT = "203.0.113.7";

/** Stands in for a rate limit binding and records the keys it was asked about. */
class FakeRateLimit {
    readonly keys: string[] = [];
    allow = true;
    fail = false;

    async limit({ key }: { key: string }) {
        this.keys.push(key);
        if (this.fail) throw new Error("rate limit unavailable");
        return { success: this.allow };
    }
}

/**
 * The gateway behind `handleData` lives as long as the process, so every test asks for rooms
 * of its own: what an earlier test left in memory cannot answer for it.
 */
function setup(t: TestContext) {
    const kv = new FakeKV(Date.now);
    const limit = new FakeRateLimit();
    const misses = new FakeRateLimit();
    const env = { CACHE: kv, RATE_LIMIT: limit, RATE_LIMIT_MISS: misses } as unknown as GatewayEnv;
    const events: GatewayEvent[] = [];
    const background: Promise<unknown>[] = [];
    const context = {
        waitUntil: (work: Promise<unknown>) => void background.push(work),
        passThroughOnException: () => {},
    } as unknown as Parameters<typeof handleData>[2];

    const asked: { url: string; headers: Record<string, string> }[] = [];
    t.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input instanceof Request ? input.url : input);
            asked.push({ url, headers: Object.fromEntries(new Headers(init?.headers)) });
            return url.startsWith(BTTV_USER)
                ? jsonResponse({ channelEmotes: [{ id: url.slice(BTTV_USER.length) }] })
                : jsonResponse({ error: "down" }, 500);
        },
    );

    const call = (path: string, on: GatewayEnv = env, headers: Record<string, string> = {}) => {
        const url = new URL(`https://chat.example${path}`);
        const request = new Request(url, { headers: { "cf-connecting-ip": CLIENT, ...headers } });
        return handleData(request, on, context, url, (event) => events.push(event));
    };
    const settle = async () => {
        while (background.length > 0) await Promise.allSettled(background.splice(0));
    };
    return { kv, limit, misses, env, events, context, asked, call, settle };
}

const cacheOf = (response: Response) => response.headers.get("x-petal-cache");

describe("handleData", () => {
    it("serves a request, counts it for its client and stores the answer behind it", async (t) => {
        const { kv, limit, misses, events, asked, call, settle } = setup(t);

        const first = await call("/api/data/bttv/3/cached/users/twitch/1001");
        assert.equal(first.status, 200);
        assert.equal(cacheOf(first), "MISS; layer=upstream");
        assert.deepEqual(await first.json(), { channelEmotes: [{ id: "1001" }] });
        assert.deepEqual(asked, [
            {
                url: `${BTTV_USER}1001`,
                headers: {
                    accept: "application/json",
                    "user-agent": "Petal (+https://github.com/shiftbloom-studio/petal)",
                },
            },
        ]);

        await settle();
        assert.deepEqual(kv.operations, ["get d1:bttv.user:1001", "put d1:bttv.user:1001"]);

        const second = await call("/api/data/bttv/3/cached/users/twitch/1001");
        assert.equal(cacheOf(second), "HIT; layer=memory");
        assert.equal(asked.length, 1);

        assert.deepEqual(limit.keys, [`data:${CLIENT}`, `data:${CLIENT}`]);
        assert.deepEqual(misses.keys, [`miss:${CLIENT}`]);
        assert.deepEqual(events, [
            { route: "bttv.user", outcome: "MISS", layer: "upstream", status: 200 },
            { route: "bttv.user", outcome: "HIT", layer: "memory", status: 200 },
        ]);
    });

    it("refuses a client over its limit before anything else happens", async (t) => {
        const { kv, limit, misses, events, asked, call } = setup(t);
        limit.allow = false;

        const response = await call("/api/data/bttv/3/cached/users/twitch/1002");
        assert.equal(response.status, 429);
        assert.equal(cacheOf(response), "ERROR");
        assert.equal(response.headers.get("retry-after"), "60");
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { error: "rate_limited" });

        assert.equal(asked.length, 0);
        assert.equal(kv.operations.length, 0);
        assert.equal(misses.keys.length, 0);
        assert.deepEqual(events, [{ route: "none", outcome: "REFUSED", status: 429 }]);
    });

    it("refuses the misses of a client that had too many, not what is stored", async (t) => {
        const { misses, events, asked, call } = setup(t);
        assert.equal((await call("/api/data/bttv/3/cached/users/twitch/1003")).status, 200);

        misses.allow = false;
        const refused = await call("/api/data/bttv/3/cached/users/twitch/1004");
        assert.equal(refused.status, 429);
        assert.equal(cacheOf(refused), "ERROR");
        assert.equal(refused.headers.get("retry-after"), "60");
        assert.equal(asked.length, 1);
        assert.deepEqual(events.at(-1), { route: "bttv.user", outcome: "REFUSED", status: 429 });

        const stored = await call("/api/data/bttv/3/cached/users/twitch/1003");
        assert.equal(stored.status, 200);
        assert.equal(cacheOf(stored), "HIT; layer=memory");
    });

    it("admits everybody while the rate limits fail", async (t) => {
        const { limit, misses, call } = setup(t);
        limit.fail = true;
        misses.fail = true;
        const response = await call("/api/data/bttv/3/cached/users/twitch/1005");
        assert.equal(response.status, 200);
        assert.equal(limit.keys.length, 1);
        assert.equal(misses.keys.length, 1);
    });

    it("works without any binding", async (t) => {
        const { call, settle } = setup(t);
        const first = await call("/api/data/bttv/3/cached/users/twitch/1006", {});
        assert.equal(first.status, 200);
        assert.equal(cacheOf(first), "MISS; layer=upstream");
        await settle();
        const second = await call("/api/data/bttv/3/cached/users/twitch/1006", {});
        assert.equal(cacheOf(second), "HIT; layer=memory");
    });

    it("works while KV fails", async (t) => {
        const { kv, call, settle } = setup(t);
        kv.failReads = true;
        kv.failWrites = true;
        const response = await call("/api/data/bttv/3/cached/users/twitch/1007");
        assert.equal(response.status, 200);
        await settle();
        assert.deepEqual(kv.operations, ["get d1:bttv.user:1007", "put d1:bttv.user:1007"]);
    });

    it("is not failed by a listener that throws", async (t) => {
        const { env, context } = setup(t);
        const url = new URL("https://chat.example/api/data/bttv/3/cached/users/twitch/1008");
        const response = await handleData(new Request(url), env, context, url, () => {
            throw new Error("analytics unavailable");
        });
        assert.equal(response.status, 200);
    });

    it("works without a listener", async (t) => {
        const { env, context } = setup(t);
        const url = new URL("https://chat.example/api/data/bttv/3/cached/users/twitch/1009");
        assert.equal((await handleData(new Request(url), env, context, url)).status, 200);
    });

    it("admits a client without an address, which no counter could tell from another", async (t) => {
        const { limit, misses, env, context } = setup(t);
        limit.allow = false;
        misses.allow = false;
        const url = new URL("https://chat.example/api/data/bttv/3/cached/users/twitch/1010");
        assert.equal((await handleData(new Request(url), env, context, url)).status, 200);
        assert.deepEqual(limit.keys, []);
        assert.deepEqual(misses.keys, []);
    });

    it("marks every answer as its own, whatever was asked", async (t) => {
        const { events, asked, call } = setup(t);
        const refused: [string, number][] = [
            ["/api/data", 400],
            ["/api/data/", 400],
            ["/api/data/bttv/3/cached/emotes/shared", 400],
            ["/api/data/7tv/v4/gql", 405],
            ["/api/data/https://api.betterttv.net/3/cached/emotes/global", 400],
        ];
        for (const [path, status] of refused) {
            const response = await call(path);
            assert.equal(response.status, status, path);
            assert.equal(cacheOf(response), "ERROR", path);
            assert.equal(response.headers.get("cache-control"), "no-store", path);
        }
        assert.equal(asked.length, 0);
        assert.ok(events.every((event) => event.route === "none" && event.outcome === "REFUSED"));
        assert.equal(events.length, refused.length);

        // The provider is down and nothing is stored: also a failure carries the header.
        const failed = await call("/api/data/ffz/v1/room/id/1011");
        assert.equal(failed.status, 502);
        assert.equal(cacheOf(failed), "ERROR");
    });

    it("keeps what the browser sent away from the provider", async (t) => {
        const { asked, call } = setup(t);
        await call("/api/data/bttv/3/cached/users/twitch/1012", undefined, {
            cookie: "session=secret",
            referer: "https://chat.example/chat/somebody",
            "user-agent": "OBS",
        });
        assert.deepEqual(Object.keys(asked[0].headers).sort(), ["accept", "user-agent"]);
        assert.ok(!JSON.stringify(asked).includes(CLIENT));
    });
});
