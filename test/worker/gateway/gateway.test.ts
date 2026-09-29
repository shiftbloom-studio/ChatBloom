import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DataGateway, type GatewayEvent } from "../../../src/worker/gateway/gateway";
import { Background, Clock, FakeKV, FakeUpstream, jsonResponse } from "./fakes";

const BTTV_GLOBAL = "https://api.betterttv.net/3/cached/emotes/global";
const BTTV_USER = "https://api.betterttv.net/3/cached/users/twitch/50985620";
const FFZ_ROOM = "https://api.frankerfacez.com/v1/room/id/50985620";
const FFZ_GLOBAL = "https://api.frankerfacez.com/v1/set/global";
const SEVENTV_USER = "https://7tv.io/v3/users/twitch/50985620";
const USER_AGENT = "Petal/test (+https://github.com/shiftbloom-studio/petal)";

function setup(options: { kv?: boolean; memoryBudget?: number } = {}) {
    const clock = new Clock();
    const upstream = new FakeUpstream();
    const kv = options.kv === false ? undefined : new FakeKV(clock.now);
    const background = new Background();
    const events: GatewayEvent[] = [];
    /** A gateway of its own is what a second isolate has: the same KV, nothing in memory. */
    const isolate = () =>
        new DataGateway({
            userAgent: USER_AGENT,
            fetch: upstream.fetch,
            now: clock.now,
            memoryBudget: options.memoryBudget,
        });
    const gateway = isolate();
    /** Stands in for the Worker's miss counter; `allowed` is what it has left. */
    const misses = { allowed: Number.POSITIVE_INFINITY, asked: 0 };
    const admit = async () => {
        misses.asked++;
        return misses.allowed-- > 0;
    };
    const get = (path: string, on = gateway, init?: RequestInit) => {
        const url = new URL(`https://chat.example/api/data${path}`);
        const context = background.context(kv, admit, (event) => events.push(event));
        return on.handle(new Request(url, init), url.pathname.slice(9), context);
    };
    return { clock, upstream, kv, background, events, gateway, isolate, get, misses };
}

const cacheOf = (response: Response) => response.headers.get("x-petal-cache");

describe("cache read and write", () => {
    it("asks the provider once, stores the answer in KV and serves it from memory", async () => {
        const { upstream, kv, background, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "a", code: "Kappa" }]);

        const first = await get("/bttv/3/cached/emotes/global");
        assert.equal(first.status, 200);
        assert.equal(cacheOf(first), "MISS; layer=upstream");
        assert.equal(first.headers.get("content-type"), "application/json; charset=utf-8");
        assert.equal(first.headers.get("cache-control"), "no-store");
        assert.equal(first.headers.get("age"), "0");
        assert.equal(first.headers.get("access-control-allow-origin"), null);
        assert.deepEqual(await first.json(), [{ id: "a", code: "Kappa" }]);

        await background.settle();
        const stored = kv?.values.get("d1:bttv.global");
        assert.equal(stored?.value, '[{"id":"a","code":"Kappa"}]');
        assert.deepEqual(stored?.metadata, { t: Date.UTC(2026, 8, 29, 12) / 1000, s: 200 });

        const second = await get("/bttv/3/cached/emotes/global");
        assert.equal(cacheOf(second), "HIT; layer=memory");
        assert.deepEqual(await second.json(), [{ id: "a", code: "Kappa" }]);
        assert.equal(upstream.calls.length, 1);
        assert.deepEqual(kv?.operations, ["get d1:bttv.global", "put d1:bttv.global"]);
    });

    it("keeps an entry in KV for as long as it may be served stale", async () => {
        const { upstream, kv, background, clock, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();
        const stored = kv?.values.get("d1:bttv.user:50985620");
        // Two minutes fresh, a week stale.
        assert.equal(stored?.expiresAt, clock.ms + (120 + 7 * 86400) * 1000);
    });

    it("serves a second isolate from KV without asking the provider", async () => {
        const { upstream, background, clock, isolate, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();
        clock.advance(90);

        const other = isolate();
        const response = await get("/bttv/3/cached/emotes/global", other);
        assert.equal(cacheOf(response), "HIT; layer=kv");
        assert.equal(response.headers.get("age"), "90");
        assert.equal(
            cacheOf(await get("/bttv/3/cached/emotes/global", other)),
            "HIT; layer=memory",
        );
        assert.equal(upstream.calls.length, 1);
    });

    it("prefers what another isolate stored over its own older copy", async () => {
        const { upstream, background, clock, isolate, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [{ id: "old" }], sharedEmotes: [] });
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();

        clock.advance(200);
        upstream.json(BTTV_USER, { channelEmotes: [{ id: "new" }], sharedEmotes: [] });
        await get("/bttv/3/cached/users/twitch/50985620", isolate());
        await background.settle();
        assert.equal(upstream.calls.length, 2);

        clock.advance(10);
        const response = await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(cacheOf(response), "HIT; layer=kv");
        assert.deepEqual(await response.json(), {
            channelEmotes: [{ id: "new" }],
            sharedEmotes: [],
        });
        assert.equal(upstream.calls.length, 2);
    });

    it("asks a channel's provider again once the entry is too old", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [{ id: "old" }], sharedEmotes: [] });
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();

        clock.advance(121);
        upstream.json(BTTV_USER, { channelEmotes: [{ id: "new" }], sharedEmotes: [] });
        const response = await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(cacheOf(response), "EXPIRED; layer=upstream");
        assert.deepEqual(await response.json(), {
            channelEmotes: [{ id: "new" }],
            sharedEmotes: [],
        });
    });

    it("serves a shared list at once and refreshes it in the background", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "old" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();

        clock.advance(601);
        upstream.json(BTTV_GLOBAL, [{ id: "new" }]);
        const stale = await get("/bttv/3/cached/emotes/global");
        assert.equal(cacheOf(stale), "UPDATING; layer=memory");
        assert.equal(stale.headers.get("age"), "601");
        assert.deepEqual(await stale.json(), [{ id: "old" }]);

        await background.settle();
        const fresh = await get("/bttv/3/cached/emotes/global");
        assert.equal(cacheOf(fresh), "HIT; layer=memory");
        assert.deepEqual(await fresh.json(), [{ id: "new" }]);
        assert.equal(upstream.calls.length, 2);
    });

    it("waits for the provider once a shared list is older than its background window", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "old" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();

        clock.advance(600 + 3600 + 1);
        upstream.json(BTTV_GLOBAL, [{ id: "new" }]);
        const response = await get("/bttv/3/cached/emotes/global");
        assert.equal(cacheOf(response), "EXPIRED; layer=upstream");
        assert.deepEqual(await response.json(), [{ id: "new" }]);
    });

    it("asks the provider once for requests that arrive together", async () => {
        const { upstream, get } = setup();
        let release = (_: Response) => {};
        upstream.answer(SEVENTV_USER, () => new Promise((resolve) => (release = resolve)));

        const requests = Array.from({ length: 5 }, () => get("/7tv/v3/users/twitch/50985620"));
        // Lets all five reach the provider call before it answers.
        await new Promise((resolve) => setTimeout(resolve, 10));
        release(jsonResponse({ id: "50985620", emote_set: null, user: { id: "u" } }));

        const responses = await Promise.all(requests);
        assert.deepEqual(
            responses.map((response) => response.status),
            [200, 200, 200, 200, 200],
        );
        assert.equal(upstream.calls.length, 1);
    });

    it("asks again after a request to the provider that never came back", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { upstream, clock, get } = setup();
        const reached = () => new Promise((resolve) => setImmediate(resolve));
        upstream.answer(SEVENTV_USER, () => new Promise(() => {}));

        const lost = get("/7tv/v3/users/twitch/50985620");
        await reached();
        const waiting = get("/7tv/v3/users/twitch/50985620");
        await reached();
        t.mock.timers.tick(7000);
        assert.equal((await lost).status, 502);
        assert.equal((await waiting).status, 502);
        assert.equal(upstream.calls.length, 1);

        clock.advance(7);
        upstream.json(SEVENTV_USER, { id: "50985620", emote_set: null, user: { id: "u" } });
        const response = await get("/7tv/v3/users/twitch/50985620");
        assert.equal(response.status, 200);
        assert.equal(cacheOf(response), "MISS; layer=upstream");
        assert.equal(upstream.calls.length, 2);
    });

    it("evicts what was used longest ago when memory is full", async () => {
        const { upstream, background, get } = setup({ memoryBudget: 600 });
        upstream.json(BTTV_GLOBAL, ["x".repeat(100)]);
        upstream.json(FFZ_GLOBAL, { sets: "y".repeat(100) });
        upstream.json(BTTV_USER, { channelEmotes: ["z".repeat(100)] });

        await get("/bttv/3/cached/emotes/global");
        await get("/ffz/v1/set/global");
        // Used again, so the FFZ list is now the one used longest ago.
        await get("/bttv/3/cached/emotes/global");
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();

        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "HIT; layer=memory");
        assert.equal(cacheOf(await get("/ffz/v1/set/global")), "HIT; layer=kv");
    });

    it("stores the trimmed 7TV payload, not the provider's", async () => {
        const { upstream, kv, background, get } = setup();
        upstream.json(SEVENTV_USER, {
            id: "50985620",
            username: "papaplatte",
            emote_set_id: null,
            emote_set: null,
            user: { id: "01FKX5Q4VG0004X8QJ9S80KD58", editors: [{ id: "e" }] },
        });
        const response = await get("/7tv/v3/users/twitch/50985620");
        const expected = {
            id: "50985620",
            emote_set_id: null,
            emote_set: null,
            user: { id: "01FKX5Q4VG0004X8QJ9S80KD58" },
        };
        assert.deepEqual(await response.json(), expected);
        await background.settle();
        assert.equal(kv?.values.get("d1:7tv.user:50985620")?.value, JSON.stringify(expected));
    });
});

describe("answers of the wrong shape", () => {
    it("treats a 7TV answer that is not what the client expects as a failure", async () => {
        const { upstream, kv, background, get } = setup();
        upstream.json(SEVENTV_USER, { status: "ok", message: "maintenance" });
        const response = await get("/7tv/v3/users/twitch/50985620");
        assert.equal(response.status, 502);
        await background.settle();
        assert.equal(kv?.values.size, 0);

        upstream.json("https://7tv.io/v3/emote-sets/global", { emotes: "none" });
        assert.equal((await get("/7tv/v3/emote-sets/global")).status, 502);
    });
});

describe("unknown channels", () => {
    it("remembers a 404 for a while, then asks again", async () => {
        const { upstream, kv, background, clock, get } = setup();
        upstream.json(FFZ_ROOM, { status: 404, error: "Not Found", message: "No such room" }, 404);

        const first = await get("/ffz/v1/room/id/50985620");
        assert.equal(first.status, 404);
        assert.equal(cacheOf(first), "MISS; layer=upstream");
        assert.equal(await first.text(), "null");
        await background.settle();
        assert.deepEqual(kv?.values.get("d1:ffz.room:50985620")?.metadata.s, 404);

        clock.advance(100);
        const second = await get("/ffz/v1/room/id/50985620");
        assert.equal(second.status, 404);
        assert.equal(cacheOf(second), "HIT; layer=memory");
        assert.equal(upstream.calls.length, 1);

        clock.advance(21);
        upstream.json(FFZ_ROOM, { room: { set: 1 }, sets: {} });
        const third = await get("/ffz/v1/room/id/50985620");
        assert.equal(third.status, 200);
        assert.equal(cacheOf(third), "EXPIRED; layer=upstream");
    });

    it("keeps a 404 for an hour at most", async () => {
        const { upstream, kv, background, clock, get } = setup();
        upstream.json(FFZ_ROOM, {}, 404);
        await get("/ffz/v1/room/id/50985620");
        await background.settle();
        assert.equal(kv?.values.get("d1:ffz.room:50985620")?.expiresAt, clock.ms + 3720 * 1000);
    });

    it("does not take a 404 for a shared list at its word", async () => {
        const { upstream, kv, background, clock, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();

        clock.advance(600 + 3600 + 1);
        upstream.json(BTTV_GLOBAL, { message: "not found" }, 404);
        const response = await get("/bttv/3/cached/emotes/global");
        assert.equal(response.status, 200);
        assert.equal(cacheOf(response), "STALE; layer=memory");
        assert.deepEqual(await response.json(), [{ id: "a" }]);
        assert.equal(kv?.values.get("d1:bttv.global")?.metadata.s, 200);
    });
});

describe("provider failures", () => {
    const failures: [string, () => Response | Promise<Response>][] = [
        ["a 500", () => jsonResponse({ error: "boom" }, 500)],
        ["a 429", () => jsonResponse({ error: "slow down" }, 429)],
        ["a redirect", () => new Response(null, { status: 302, headers: { location: "/x" } })],
        ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
        ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
        [
            "an HTML page",
            () => new Response("<html>", { headers: { "content-type": "text/html" } }),
        ],
        [
            "broken JSON",
            () => new Response("{", { headers: { "content-type": "application/json" } }),
        ],
        [
            "a bare JSON value",
            () => new Response("42", { headers: { "content-type": "application/json" } }),
        ],
        ["an oversized body", () => jsonResponse({ padding: "x".repeat(2 * 1024 * 1024) })],
        [
            "a body that lies about its size",
            () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            const chunk = new TextEncoder().encode(`"${"x".repeat(65536)}"`);
                            for (let i = 0; i < 40; i++) controller.enqueue(chunk);
                            controller.close();
                        },
                    }),
                    { headers: { "content-type": "application/json" } },
                ),
        ],
    ];

    for (const [name, answer] of failures) {
        it(`serves the stored answer when the provider gives ${name}`, async () => {
            const { upstream, kv, background, clock, get } = setup();
            upstream.json(BTTV_USER, { channelEmotes: [{ id: "kept" }], sharedEmotes: [] });
            await get("/bttv/3/cached/users/twitch/50985620");
            await background.settle();

            clock.advance(3 * 86400);
            upstream.answer(BTTV_USER, answer);
            const response = await get("/bttv/3/cached/users/twitch/50985620");
            assert.equal(response.status, 200);
            assert.equal(cacheOf(response), "STALE; layer=memory");
            assert.equal(response.headers.get("age"), String(3 * 86400));
            assert.deepEqual(await response.json(), {
                channelEmotes: [{ id: "kept" }],
                sharedEmotes: [],
            });
            await background.settle();
            // The failure must not overwrite, or prolong, what is stored.
            assert.equal(kv?.operations.filter((op) => op.startsWith("put")).length, 1);
        });

        it(`answers 502 when the provider gives ${name} and nothing is stored`, async () => {
            const { upstream, kv, background, get } = setup();
            upstream.answer(BTTV_USER, answer);
            const response = await get("/bttv/3/cached/users/twitch/50985620");
            assert.equal(response.status, 502);
            assert.equal(cacheOf(response), "ERROR");
            assert.equal(response.headers.get("cache-control"), "no-store");
            assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
            await background.settle();
            assert.equal(kv?.values.size, 0);
        });
    }

    it("serves the stored answer from KV in an isolate that never saw the provider work", async () => {
        const { upstream, background, clock, isolate, get } = setup();
        upstream.json(SEVENTV_USER, {
            id: "1",
            emote_set_id: null,
            emote_set: null,
            user: { id: "u" },
        });
        await get("/7tv/v3/users/twitch/50985620");
        await background.settle();

        clock.advance(6 * 86400);
        upstream.json(SEVENTV_USER, { error: "down" }, 503);
        const response = await get("/7tv/v3/users/twitch/50985620", isolate());
        assert.equal(response.status, 200);
        assert.equal(cacheOf(response), "STALE; layer=kv");
    });

    it("stops serving an answer once it is older than the stale window", async () => {
        const { upstream, background, clock, isolate, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();

        clock.advance(120 + 7 * 86400 + 1);
        upstream.json(BTTV_USER, { error: "down" }, 500);
        // Memory still holds the entry; KV has dropped it.
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 502);
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620", isolate())).status, 502);
    });

    it("leaves a failing provider alone for a while, doubling the pause", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(BTTV_USER, { error: "down" }, 500);

        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 502);
        const paused = await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(paused.status, 503);
        assert.deepEqual(await paused.json(), { error: "upstream_backoff" });
        const retryAfter = Number(paused.headers.get("retry-after"));
        assert.ok(retryAfter >= 3 && retryAfter <= 7, `retry-after ${retryAfter}`);
        assert.equal(upstream.calls.length, 1);

        // Past the first pause of 5 s and its jitter.
        clock.advance(7);
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 502);
        assert.equal(upstream.calls.length, 2);
        clock.advance(7);
        // The second pause is 10 s, so 7 s later the provider is still left alone.
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 503);
        assert.equal(upstream.calls.length, 2);

        clock.advance(6);
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 200);
        await background.settle();

        // Success forgets the pause: the next failure starts at 5 s again.
        clock.advance(121);
        upstream.json(BTTV_USER, { error: "down" }, 500);
        assert.equal(
            cacheOf(await get("/bttv/3/cached/users/twitch/50985620")),
            "STALE; layer=memory",
        );
        clock.advance(7);
        await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(upstream.calls.length, 5);
    });

    it("pauses one failing resource without pausing its provider", async () => {
        const { upstream, get } = setup();
        upstream.json(BTTV_USER, { error: "broken channel" }, 500);
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 502);
        assert.equal((await get("/bttv/3/cached/emotes/global")).status, 200);
    });

    it("pauses the whole provider on a 429, for as long as it asks", async () => {
        const { upstream, get } = setup();
        upstream.answer(FFZ_ROOM, () => jsonResponse({}, 429, { "retry-after": "120" }));
        assert.equal((await get("/ffz/v1/room/id/50985620")).status, 502);

        upstream.json(FFZ_GLOBAL, { default_sets: [], sets: {}, users: {} });
        const other = await get("/ffz/v1/set/global");
        assert.equal(other.status, 503);
        const retryAfter = Number(other.headers.get("retry-after"));
        assert.ok(retryAfter >= 90 && retryAfter <= 150, `retry-after ${retryAfter}`);
        assert.equal(upstream.calls.length, 1);

        upstream.json(BTTV_GLOBAL, []);
        assert.equal((await get("/bttv/3/cached/emotes/global")).status, 200);
    });

    it("serves stale without asking while the provider is paused", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(FFZ_GLOBAL, { default_sets: [], sets: {}, users: {} });
        upstream.json(FFZ_ROOM, { room: {}, sets: {} });
        await get("/ffz/v1/set/global");
        await get("/ffz/v1/room/id/50985620");
        await background.settle();

        clock.advance(601);
        upstream.answer(FFZ_ROOM, () => jsonResponse({}, 429, { "retry-after": "300" }));
        assert.equal(cacheOf(await get("/ffz/v1/room/id/50985620")), "STALE; layer=memory");
        const asked = upstream.calls.length;

        clock.advance(200);
        assert.equal(cacheOf(await get("/ffz/v1/room/id/50985620")), "STALE; layer=memory");
        // Without the pause this list would be refreshed in the background.
        assert.equal(cacheOf(await get("/ffz/v1/set/global")), "STALE; layer=memory");
        await background.settle();
        assert.equal(upstream.calls.length, asked);
    });

    it("never pauses for longer than five minutes, whatever the provider asks", async () => {
        const { upstream, clock, get } = setup();
        upstream.answer(FFZ_ROOM, () => jsonResponse({}, 429, { "retry-after": "86400" }));
        await get("/ffz/v1/room/id/50985620");
        clock.advance(376);
        upstream.json(FFZ_ROOM, { room: {}, sets: {} });
        assert.equal((await get("/ffz/v1/room/id/50985620")).status, 200);
    });

    it("records a failed background refresh and keeps serving the list", async () => {
        const { upstream, background, clock, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();

        clock.advance(700);
        upstream.json(BTTV_GLOBAL, { error: "down" }, 500);
        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "UPDATING; layer=memory");
        await background.settle();
        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "STALE; layer=memory");
        assert.equal(upstream.calls.length, 2);
    });
});

describe("admission of misses", () => {
    it("asks before a miss, and not for anything that is stored", async () => {
        const { upstream, background, clock, misses, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        upstream.json(BTTV_GLOBAL, []);

        await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(misses.asked, 1);
        await get("/bttv/3/cached/users/twitch/50985620");
        await background.settle();
        clock.advance(121);
        assert.equal(
            cacheOf(await get("/bttv/3/cached/users/twitch/50985620")),
            "EXPIRED; layer=upstream",
        );
        assert.equal(misses.asked, 1);

        await get("/bttv/3/cached/emotes/global");
        assert.equal(misses.asked, 2);
        await get("/bttv/3/cached/emotes/shared");
        assert.equal(misses.asked, 2);
    });

    it("refuses a miss that is not admitted, without asking the provider", async () => {
        const { upstream, kv, background, misses, events, get } = setup();
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        await get("/bttv/3/cached/emotes/global");
        await background.settle();

        misses.allowed = 0;
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        const refused = await get("/bttv/3/cached/users/twitch/50985620");
        assert.equal(refused.status, 429);
        assert.equal(cacheOf(refused), "ERROR");
        assert.equal(refused.headers.get("retry-after"), "60");
        assert.deepEqual(await refused.json(), { error: "rate_limited" });
        assert.equal(upstream.calls.length, 1);
        await background.settle();
        assert.deepEqual([...(kv?.values.keys() ?? [])], ["d1:bttv.global"]);
        assert.deepEqual(events.at(-1), { route: "bttv.user", outcome: "REFUSED", status: 429 });

        // What is stored is served all the same.
        assert.equal((await get("/bttv/3/cached/emotes/global")).status, 200);
    });

    it("counts a miss once, however many requests wait for its answer", async () => {
        const { upstream, misses, get } = setup();
        let release = (_: Response) => {};
        upstream.answer(BTTV_USER, () => new Promise((resolve) => (release = resolve)));

        const first = get("/bttv/3/cached/users/twitch/50985620");
        await new Promise((resolve) => setTimeout(resolve, 10));
        misses.allowed = 0;
        const waiting = [1, 2, 3].map(() => get("/bttv/3/cached/users/twitch/50985620"));
        await new Promise((resolve) => setTimeout(resolve, 10));
        release(jsonResponse({ channelEmotes: [], sharedEmotes: [] }));

        for (const response of await Promise.all([first, ...waiting])) {
            assert.equal(response.status, 200);
        }
        assert.equal(misses.asked, 1);
        assert.equal(upstream.calls.length, 1);
    });

    it("works without a miss counter", async () => {
        const { upstream, gateway, background } = setup();
        upstream.json(BTTV_GLOBAL, []);
        const url = new URL("https://chat.example/api/data/bttv/3/cached/emotes/global");
        const response = await gateway.handle(
            new Request(url),
            url.pathname.slice(9),
            background.context(),
        );
        assert.equal(response.status, 200);
    });
});

describe("missing or failing bindings", () => {
    it("works without KV", async () => {
        const { upstream, get } = setup({ kv: false });
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "MISS; layer=upstream");
        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "HIT; layer=memory");
        assert.equal(upstream.calls.length, 1);
    });

    it("works when KV reads and writes fail", async () => {
        const { upstream, kv, background, clock, get } = setup();
        assert.ok(kv);
        kv.failReads = true;
        kv.failWrites = true;
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        assert.equal((await get("/bttv/3/cached/users/twitch/50985620")).status, 200);
        await background.settle();
        clock.advance(121);
        assert.equal(
            cacheOf(await get("/bttv/3/cached/users/twitch/50985620")),
            "EXPIRED; layer=upstream",
        );
        await background.settle();
    });

    it("ignores KV values it did not write", async () => {
        const { upstream, kv, get } = setup();
        kv?.values.set("d1:bttv.global", {
            value: "[]",
            metadata: {} as never,
            expiresAt: Number.POSITIVE_INFINITY,
        });
        upstream.json(BTTV_GLOBAL, [{ id: "a" }]);
        assert.equal(cacheOf(await get("/bttv/3/cached/emotes/global")), "MISS; layer=upstream");
    });
});

describe("defects", () => {
    it("answers 500 and logs the route once a minute, however many requests fail", async (t) => {
        const { clock, upstream, background, events, gateway } = setup();
        const logged = t.mock.method(console, "error", () => {});
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        const broken = () => {
            const url = new URL(
                "https://chat.example/api/data/bttv/3/cached/users/twitch/50985620",
            );
            const admit = () => Promise.reject(new Error("the binding broke"));
            const context = background.context(undefined, admit, (event) => events.push(event));
            return gateway.handle(new Request(url), url.pathname.slice(9), context);
        };

        const response = await broken();
        assert.equal(response.status, 500);
        assert.equal(cacheOf(response), "ERROR");
        assert.deepEqual(await response.json(), { error: "gateway_failure" });
        assert.deepEqual(events, [{ route: "bttv.user", outcome: "ERROR", status: 500 }]);

        clock.advance(59);
        await broken();
        assert.equal(logged.mock.callCount(), 1);
        assert.equal(logged.mock.calls[0].arguments[1], "bttv.user");
        assert.ok(!logged.mock.calls[0].arguments.slice(0, 2).join(" ").includes("50985620"));

        clock.advance(1);
        await broken();
        assert.equal(logged.mock.callCount(), 2);
        assert.equal(upstream.calls.length, 0);
    });
});

describe("what the provider and the browser get to see", () => {
    it("forwards nothing of the browser's request", async () => {
        const { upstream, gateway, get } = setup();
        upstream.json(BTTV_GLOBAL, []);
        await get("/bttv/3/cached/emotes/global", gateway, {
            headers: {
                cookie: "session=secret",
                authorization: "Bearer secret",
                "x-forwarded-for": "203.0.113.7",
                "user-agent": "OBS",
                referer: "https://chat.example/chat/papaplatte",
                origin: "https://chat.example",
                "accept-language": "de",
            },
        });
        assert.deepEqual(upstream.calls, [
            {
                url: BTTV_GLOBAL,
                method: "GET",
                headers: { accept: "application/json", "user-agent": USER_AGENT },
                body: undefined,
                redirect: "manual",
            },
        ]);
    });

    it("passes on none of the provider's headers", async () => {
        const { upstream, get } = setup();
        upstream.answer(BTTV_GLOBAL, () =>
            jsonResponse([], 200, {
                "set-cookie": "tracking=1",
                "access-control-allow-origin": "*",
                "cache-control": "max-age=300",
                "x-ratelimit-remaining": "12",
            }),
        );
        const response = await get("/bttv/3/cached/emotes/global");
        assert.deepEqual([...response.headers.keys()].sort(), [
            "age",
            "cache-control",
            "content-type",
            "x-content-type-options",
            "x-petal-cache",
        ]);
    });

    it("refuses requests outside the allowlist without asking anyone", async () => {
        const { upstream, kv, events, get } = setup();
        const cases: [string, RequestInit | undefined, number, string][] = [
            ["/bttv/3/cached/emotes/shared", undefined, 400, "unsupported_route"],
            ["/7tv/v3/users/twitch/papaplatte", undefined, 400, "unsupported_route"],
            ["/7tv/v3/emote-sets/global?x=1", undefined, 400, "invalid_query"],
            ["/ivr/v2/twitch/badges/channel?id=1&id=2", undefined, 400, "invalid_query"],
            [
                "/bttv/3/cached/emotes/global",
                { method: "POST", body: "{}" },
                405,
                "method_not_allowed",
            ],
        ];
        for (const [path, init, status, error] of cases) {
            const response = await get(path, undefined, init);
            assert.equal(response.status, status, path);
            assert.equal(cacheOf(response), "ERROR");
            assert.deepEqual(await response.json(), { error });
        }
        assert.equal(upstream.calls.length, 0);
        assert.equal(kv?.operations.length, 0);
        assert.ok(events.every((event) => event.outcome === "REFUSED" && event.route === "none"));
    });

    it("reports counters that name the route and nothing else", async () => {
        const { upstream, events, get } = setup();
        upstream.json(BTTV_USER, { channelEmotes: [], sharedEmotes: [] });
        upstream.json(FFZ_ROOM, {}, 500);
        await get("/bttv/3/cached/users/twitch/50985620");
        await get("/bttv/3/cached/users/twitch/50985620");
        await get("/ffz/v1/room/id/50985620");
        assert.deepEqual(events, [
            { route: "bttv.user", outcome: "MISS", layer: "upstream", status: 200 },
            { route: "bttv.user", outcome: "HIT", layer: "memory", status: 200 },
            { route: "ffz.room", outcome: "ERROR", status: 502 },
        ]);
        assert.ok(!JSON.stringify(events).includes("50985620"));
    });
});
