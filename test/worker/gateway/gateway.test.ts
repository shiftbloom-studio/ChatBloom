import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V4_PAINT_FIELDS as CLIENT_PAINT_FIELDS } from "../../../src/lib/chat/providers/seventv/paint";
import { DataGateway, type EntryMetadata, type KVLike } from "../../../src/worker/gateway/gateway";
import * as paints from "../../../src/worker/gateway/paints";

const BTTV_GLOBAL = "https://api.betterttv.net/3/cached/emotes/global";
const BTTV_USER = "https://api.betterttv.net/3/cached/users/twitch/50985620";
const GLOBAL = "/bttv/3/cached/emotes/global";
const USER = "/bttv/3/cached/users/twitch/50985620";
const START = Date.UTC(2026, 8, 29, 12);

const paintId = (n: number) => `01FQB6K5T0000BDD0YMN2${String(n).padStart(5, "0")}`;
const paint = (id: string) => ({ id, name: "Paint", data: { layers: [], shadows: [] } });

/** Answers a paints query the way 7TV does for paints it knows. */
function answerPaints(body = "{}") {
    const ids = Object.values((JSON.parse(body) as { variables: object }).variables);
    const answer = Object.fromEntries(ids.map((id, i) => [`p${i}`, paint(id)]));
    return Response.json({ data: { paints: answer } });
}

function setup() {
    let ms = START;
    const advance = (seconds: number) => {
        ms += seconds * 1000;
    };
    /** In-memory stand-in for KV that enforces the limits the gateway must respect. */
    const stored = new Map<string, { value: string; metadata: EntryMetadata; at: number }>();
    const kv: KVLike = {
        async getWithMetadata(key, { cacheTtl = 30 }) {
            if (cacheTtl < 30) throw new Error("KV GET failed: 400 Invalid cache_ttl");
            const entry = stored.get(key);
            return entry && entry.at > ms ? entry : { value: null, metadata: null };
        },
        async put(key, value, { expirationTtl, metadata }) {
            if (expirationTtl < 60 || JSON.stringify(metadata).length > 1024) {
                throw new Error("KV PUT failed: 400 Bad Request");
            }
            stored.set(key, { value, metadata, at: ms + expirationTtl * 1000 });
        },
    };
    /** Stands in for the providers: answers by URL and records what the gateway sent. */
    type Answer = (body?: string) => Response | Promise<Response>;
    const answers = new Map<string, Answer>([["https://7tv.io/v4/gql", answerPaints]]);
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const [url, body] = [String(input), init?.body as string | undefined];
        calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers)), body });
        const answer = answers.get(url);
        if (!answer) throw new TypeError(`fetch failed: no answer for ${url}`);
        return answer(body);
    };
    const json = (url: string, body: unknown) => answers.set(url, () => Response.json(body));
    const work: Promise<unknown>[] = [];
    const settle = async () => {
        while (work.length > 0) await Promise.allSettled(work.splice(0));
    };
    /** A gateway of its own is what a second isolate has: the same KV, nothing in memory. */
    const isolate = () => new DataGateway({ userAgent: "Petal/test", fetch, now: () => ms });
    const gateway = isolate();
    /** Stands in for the Worker's miss counter; `allowed` is what it has left. */
    const misses = { allowed: Number.POSITIVE_INFINITY };
    const get = (path: string, on = gateway, init?: RequestInit) => {
        const url = new URL(`https://chat.example/api/data${path}`);
        const admit = async () => misses.allowed-- > 0;
        const context = { kv, admit, waitUntil: (job: Promise<unknown>) => void work.push(job) };
        return on.handle(new Request(url, init), url.pathname.slice(9), context);
    };
    const post = (body: string) => get("/7tv/v4/gql", undefined, { method: "POST", body });
    return { advance, stored, answers, calls, json, settle, isolate, get, post, misses };
}

const cacheOf = (response: Response) => response.headers.get("x-petal-cache");

describe("cache", () => {
    it("asks the provider once and serves the answer from memory, then from KV", async () => {
        const { advance, stored, calls, json, settle, isolate, get } = setup();
        json(BTTV_USER, [{ id: "a" }]);
        const first = await get(USER);
        assert.equal(cacheOf(first), "MISS; layer=upstream");
        await settle();
        // Two minutes fresh, a week stale.
        assert.equal(stored.get("d1:bttv.user:50985620")?.at, START + 604920 * 1000);
        assert.equal(cacheOf(await get(USER)), "HIT; layer=memory");

        advance(90);
        const other = await get(USER, isolate());
        assert.equal(cacheOf(other), "HIT; layer=kv");
        assert.equal(calls.length, 1);
    });

    it("asks again for a channel's old data, and refreshes a shared list behind it", async () => {
        const cases: [string, string, number, string, string][] = [
            [USER, BTTV_USER, 121, "EXPIRED; layer=upstream", "new"],
            [GLOBAL, BTTV_GLOBAL, 601, "UPDATING; layer=memory", "old"],
        ];
        for (const [path, url, seconds, cache, served] of cases) {
            const { advance, json, settle, get } = setup();
            json(url, [{ id: "old" }]);
            await get(path);
            await settle();
            advance(seconds);
            json(url, [{ id: "new" }]);
            const response = await get(path);
            assert.equal(cacheOf(response), cache, `${path} after ${seconds} s`);
            assert.deepEqual(await response.json(), [{ id: served }]);
            await settle();
            assert.deepEqual(await (await get(path)).json(), [{ id: "new" }]);
        }
    });
});

describe("provider failures", () => {
    const failures: [string, () => Response | Promise<Response>][] = [
        ["a 500", () => Response.json({ error: "boom" }, { status: 500 })],
        ["a redirect", () => new Response(null, { status: 302, headers: { location: "/x" } })],
        ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
        ["an oversized body", () => Response.json({ padding: "x".repeat(2 * 1024 * 1024) })],
    ];

    for (const [name, answer] of failures) {
        it(`serves what is stored, or else 502, when the provider gives ${name}`, async () => {
            const stored = setup();
            stored.json(BTTV_USER, [{ id: "kept" }]);
            await stored.get(USER);
            await stored.settle();
            stored.advance(3 * 86400);
            stored.answers.set(BTTV_USER, answer);
            const stale = await stored.get(USER);
            assert.equal(cacheOf(stale), "STALE; layer=memory");
            assert.deepEqual(await stale.json(), [{ id: "kept" }]);
            await stored.settle();
            // The failure must not overwrite, or prolong, what is stored.
            assert.equal(stored.stored.get("d1:bttv.user:50985620")?.at, START + 604920 * 1000);

            const empty = setup();
            empty.answers.set(BTTV_USER, answer);
            const failed = await empty.get(USER);
            assert.equal(failed.status, 502);
            assert.equal(cacheOf(failed), "ERROR");
            await empty.settle();
            assert.equal(empty.stored.size, 0);
        });
    }

    it("gives up on a provider that never answers", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { answers, get } = setup();
        answers.set(BTTV_USER, () => new Promise(() => {}));
        const lost = get(USER);
        // Lets the request reach the provider before the clock runs out.
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(7000);
        assert.equal((await lost).status, 502);
    });
});

describe("refusals", () => {
    it("refuses a miss that is not admitted, but serves what is stored", async () => {
        const { json, settle, get, misses } = setup();
        json(BTTV_GLOBAL, []);
        await get(GLOBAL);
        await settle();
        misses.allowed = 0;
        assert.equal((await get(USER)).status, 429);
        assert.equal((await get(GLOBAL)).status, 200);
    });

    it("refuses requests outside the allowlist without asking anyone", async () => {
        const { calls, get, post } = setup();
        const query = (variables: object, text = "x") =>
            post(JSON.stringify({ query: text, variables }));
        const many = Array.from({ length: paints.PAINTS_PER_REQUEST + 1 }, (_, i) => paintId(i));
        const cases: [Promise<Response>, number][] = [
            [get("/bttv/3/cached/users/twitch/1%2F.."), 400],
            [get("//7tv.io/v3/emote-sets/global"), 400],
            [get("/ivr/v2/twitch/badges/channel?id=1&id=2"), 400],
            [get(GLOBAL, undefined, { method: "POST", body: "{}" }), 405],
            [query(paints.buildPaintsQuery(many).variables), 400],
            [query({}, "x".repeat(40_000)), 413],
        ];
        for (const [index, [response, status]] of cases.entries()) {
            assert.equal((await response).status, status, `case ${index}`);
            assert.equal(cacheOf(await response), "ERROR");
        }
        assert.equal(calls.length, 0);
    });

    it("passes nothing of the browser's request on, and nothing of the provider's answer", async () => {
        const { answers, calls, get } = setup();
        const tracking = { "set-cookie": "tracking=1", "access-control-allow-origin": "*" };
        answers.set(BTTV_GLOBAL, () => Response.json([], { headers: tracking }));
        const response = await get(GLOBAL, undefined, {
            headers: { cookie: "session=secret", "x-forwarded-for": "203.0.113.7", referer: "x" },
        });
        const sent = { accept: "application/json", "user-agent": "Petal/test" };
        assert.deepEqual(calls[0]?.headers, sent);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
});

describe("paints", () => {
    it("splits what it asks into queries 7TV accepts, and sends only its own", async () => {
        const { calls, post } = setup();
        const ids = Array.from({ length: paints.PAINTS_PER_REQUEST }, (_, i) => paintId(i));
        const body = { ...paints.buildPaintsQuery(ids), query: "{ users { id } }" };
        const response = await post(JSON.stringify(body));
        const { data } = (await response.json()) as { data: { paints: object } };
        assert.deepEqual(Object.values(data.paints), ids.map(paint));
        const n = paints.PAINTS_PER_QUERY;
        const chunks = [ids.slice(0, n), ids.slice(n, 2 * n), ids.slice(2 * n)];
        const queries = chunks.map((chunk) => JSON.stringify(paints.buildPaintsQuery(chunk)));
        const sent = calls.map((call) => call.body);
        assert.deepEqual(sent, queries);
    });

    it("asks for the selection the client reads", () => {
        assert.equal(paints.V4_PAINT_FIELDS, CLIENT_PAINT_FIELDS);
    });
});
