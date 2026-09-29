import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DataGateway } from "../../../src/worker/gateway/gateway";
import {
    buildPaintsQuery,
    PAINTS_PER_QUERY,
    parsePaintsRequest,
} from "../../../src/worker/gateway/paints";
import { Background, Clock, FakeKV, FakeUpstream, jsonResponse } from "./fakes";

const GQL = "https://7tv.io/v4/gql";
const USER_AGENT = "Petal/test";

/** Distinct, well-formed paint ids. */
const paintId = (n: number) => `01FQB6K5T0000BDD0YMN2${String(n).padStart(5, "0")}`;
const paint = (id: string, name = `Paint ${id.slice(-2)}`) => ({
    id,
    name,
    data: { layers: [], shadows: [] },
});

function setup() {
    const clock = new Clock();
    const upstream = new FakeUpstream();
    const kv = new FakeKV(clock.now);
    const background = new Background();
    /** Paints 7TV knows; any other id resolves to null, as it does at 7TV. */
    const known = new Map<string, unknown>();
    const answerFromKnown = () => {
        upstream.answer(GQL, () => {
            const sent = JSON.parse(upstream.calls.at(-1)?.body ?? "{}") as {
                variables: Record<string, string>;
            };
            const paints = Object.fromEntries(
                Object.values(sent.variables).map((id, i) => [`p${i}`, known.get(id) ?? null]),
            );
            return jsonResponse({ data: { paints }, extensions: { analyzer: {} } });
        });
    };
    answerFromKnown();
    const isolate = () =>
        new DataGateway({ userAgent: USER_AGENT, fetch: upstream.fetch, now: clock.now });
    const gateway = isolate();
    const misses = { allowed: Number.POSITIVE_INFINITY, asked: 0 };
    const admit = async () => {
        // Answers late, the way a binding does.
        await new Promise((resolve) => setTimeout(resolve, 5));
        misses.asked++;
        return misses.allowed-- > 0;
    };
    const post = (body: string, on = gateway) =>
        on.handle(
            new Request("https://chat.example/api/data/7tv/v4/gql", {
                method: "POST",
                headers: { "content-type": "application/json", cookie: "session=secret" },
                body,
            }),
            "/7tv/v4/gql",
            background.context(kv, admit),
        );
    /** Asks the way the client does. */
    const ask = (ids: string[], on = gateway) => post(JSON.stringify(buildPaintsQuery(ids)), on);
    /** The ids of each query sent to 7TV. */
    const asked = () =>
        upstream.calls.map((call) =>
            Object.values((JSON.parse(call.body ?? "{}") as { variables: object }).variables),
        );
    return {
        clock,
        upstream,
        kv,
        background,
        known,
        answerFromKnown,
        isolate,
        post,
        ask,
        asked,
        misses,
    };
}

const cacheOf = (response: Response) => response.headers.get("x-petal-cache");

describe("paints request", () => {
    const a = paintId(1);
    const b = paintId(2);

    it("reads the ids of the client's request in order", () => {
        assert.deepEqual(parsePaintsRequest(JSON.stringify(buildPaintsQuery([b, a, b]))), [
            b,
            a,
            b,
        ]);
        assert.deepEqual(parsePaintsRequest(`{"variables":{"i1":"${b}","i0":"${a}"},"query":""}`), [
            a,
            b,
        ]);
        assert.deepEqual(
            parsePaintsRequest(`{"query":"x","variables":{"i0":"${"ab".repeat(12)}"}}`),
            ["ab".repeat(12)],
        );
    });

    it("refuses everything that is not that request", () => {
        const many = Object.fromEntries(
            Array.from({ length: 26 }, (_, i) => [`i${i}`, paintId(i)]),
        );
        const refused = [
            "",
            "null",
            "[]",
            '"query"',
            "{",
            "{}",
            `{"query":"x"}`,
            `{"variables":{"i0":"${a}"}}`,
            `{"query":"x","variables":{}}`,
            `{"query":"x","variables":[]}`,
            `{"query":"x","variables":null}`,
            `{"query":"x","variables":["${a}"]}`,
            `{"query":1,"variables":{"i0":"${a}"}}`,
            `{"query":"x","variables":{"i0":"${a}"},"operationName":"x"}`,
            `{"query":"x","variables":{"i0":"${a}"},"extensions":{}}`,
            `{"query":"x","variables":{"i1":"${a}"}}`,
            `{"query":"x","variables":{"i0":"${a}","i2":"${b}"}}`,
            `{"query":"x","variables":{"i0":"${a}","id":"${b}"}}`,
            `{"query":"x","variables":{"i0":"${a.toLowerCase()}"}}`,
            `{"query":"x","variables":{"i0":"${a}x"}}`,
            `{"query":"x","variables":{"i0":"not-an-id"}}`,
            `{"query":"x","variables":{"i0":""}}`,
            `{"query":"x","variables":{"i0":123}}`,
            `{"query":"x","variables":{"i0":["${a}"]}}`,
            `{"query":"x","variables":{"i0":{"id":"${a}"}}}`,
            `{"query":"${"x".repeat(24 * 1024 + 1)}","variables":{"i0":"${a}"}}`,
            JSON.stringify({ query: "x", variables: many }),
        ];
        for (const body of refused) {
            assert.equal(parsePaintsRequest(body), undefined, body.slice(0, 80));
        }
    });

    it("builds the query with one aliased field per paint", () => {
        const { query, variables } = buildPaintsQuery([a, b]);
        assert.deepEqual(variables, { i0: a, i1: b });
        assert.match(
            query,
            /^query\(\$i0: Id!, \$i1: Id!\) \{ paints \{\np0: paint\(id: \$i0\) \{ id name data/,
        );
        assert.equal(query.match(/paint\(id:/g)?.length, 2);
    });
});

describe("paints through the gateway", () => {
    it("answers in the shape of 7TV's own answer", async () => {
        const { known, ask } = setup();
        const [a, b, unknown] = [paintId(1), paintId(2), paintId(3)];
        known.set(a, paint(a)).set(b, paint(b));

        const response = await ask([b, unknown, a, b]);
        assert.equal(response.status, 200);
        assert.equal(cacheOf(response), "MISS; layer=upstream");
        assert.deepEqual(await response.json(), {
            data: { paints: { p0: paint(b), p1: null, p2: paint(a), p3: paint(b) } },
        });
    });

    it("sends its own query, never the client's", async () => {
        const { upstream, known, post } = setup();
        const a = paintId(1);
        known.set(a, paint(a));
        const response = await post(
            JSON.stringify({
                query: "{ users { user(id: $i0) { mainConnection { platformUsername } } } }",
                variables: { i0: a },
            }),
        );
        assert.equal(response.status, 200);
        assert.deepEqual(upstream.calls, [
            {
                url: GQL,
                method: "POST",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "user-agent": USER_AGENT,
                },
                body: JSON.stringify(buildPaintsQuery([a])),
                redirect: "manual",
            },
        ]);
    });

    it("refuses malformed and oversized bodies without asking 7TV", async () => {
        const { upstream, kv, post } = setup();
        const invalid = await post('{"query":"{ __schema { types { name } } }"}');
        assert.equal(invalid.status, 400);
        assert.equal(cacheOf(invalid), "ERROR");
        assert.deepEqual(await invalid.json(), { error: "invalid_body" });

        const large = await post(JSON.stringify({ query: "x".repeat(40_000), variables: {} }));
        assert.equal(large.status, 413);
        assert.deepEqual(await large.json(), { error: "body_too_large" });

        assert.equal(upstream.calls.length, 0);
        assert.equal(kv.operations.length, 0);
    });

    it("stores each paint on its own and asks only for the ones it lacks", async () => {
        const { kv, background, known, isolate, ask, asked } = setup();
        const [a, b, c] = [paintId(1), paintId(2), paintId(3)];
        known.set(a, paint(a)).set(b, paint(b)).set(c, paint(c));

        await ask([a, b]);
        await background.settle();
        assert.deepEqual([...kv.values.keys()], [`d1:7tv.paint:${a}`, `d1:7tv.paint:${b}`]);
        assert.deepEqual(kv.values.get(`d1:7tv.paint:${a}`)?.value, JSON.stringify(paint(a)));

        const mixed = await ask([c, a]);
        assert.equal(cacheOf(mixed), "MISS; layer=upstream");
        assert.deepEqual(await mixed.json(), { data: { paints: { p0: paint(c), p1: paint(a) } } });
        assert.deepEqual(asked(), [[a, b], [c]]);

        const cached = await ask([b, c, a]);
        assert.equal(cacheOf(cached), "HIT; layer=memory");
        await background.settle();

        const elsewhere = await ask([a, b, c], isolate());
        assert.equal(cacheOf(elsewhere), "HIT; layer=kv");
        assert.deepEqual(asked(), [[a, b], [c]]);
    });

    it("splits what it asks into queries 7TV accepts", async () => {
        const { known, ask, asked } = setup();
        const ids = Array.from({ length: 25 }, (_, i) => paintId(i));
        for (const id of ids) known.set(id, paint(id));

        const response = await ask(ids);
        const { data } = (await response.json()) as { data: { paints: Record<string, unknown> } };
        assert.deepEqual(
            Object.entries(data.paints),
            ids.map((id, i) => [`p${i}`, paint(id)]),
        );
        assert.deepEqual(
            asked().map((chunk) => chunk.length),
            [PAINTS_PER_QUERY, PAINTS_PER_QUERY, 1],
        );
        assert.deepEqual(asked().flat(), ids);
    });

    it("asks once for a paint that several overlays want at the same moment", async () => {
        const { upstream, known, ask, answerFromKnown } = setup();
        const a = paintId(1);
        known.set(a, paint(a));
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        upstream.answer(GQL, async () => {
            await held;
            return jsonResponse({ data: { paints: { p0: paint(a) } } });
        });

        const requests = [ask([a]), ask([a]), ask([a])];
        await new Promise((resolve) => setTimeout(resolve, 10));
        release();
        for (const response of await Promise.all(requests)) {
            assert.deepEqual(await response.json(), { data: { paints: { p0: paint(a) } } });
        }
        assert.equal(upstream.calls.length, 1);
        answerFromKnown();
    });

    it("counts one miss per request, however many paints are new", async () => {
        const { known, misses, ask, asked } = setup();
        const ids = Array.from({ length: 5 }, (_, i) => paintId(i));
        for (const id of ids) known.set(id, paint(id));
        assert.equal((await ask(ids)).status, 200);
        assert.equal(misses.asked, 1);
        assert.deepEqual(asked(), [ids]);

        assert.equal((await ask(ids)).status, 200);
        assert.equal(misses.asked, 1);

        misses.allowed = 0;
        const refused = await ask([ids[0], paintId(9)]);
        assert.equal(refused.status, 429);
        assert.equal(asked().length, 1);
    });

    it("refreshes old paints and fetches new ones in the same request", async () => {
        const { clock, background, known, ask, asked } = setup();
        const [old, fresh, added] = [paintId(1), paintId(2), paintId(3)];
        known.set(old, paint(old)).set(fresh, paint(fresh)).set(added, paint(added));
        await ask([old]);
        await background.settle();
        clock.advance(8 * 86400 + 1);
        await ask([fresh]);
        await background.settle();

        // The old paint turns to 7TV at once, the new one only after it was admitted.
        const response = await ask([old, fresh, added]);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            data: { paints: { p0: paint(old), p1: paint(fresh), p2: paint(added) } },
        });
        assert.deepEqual(asked().slice(2), [[old], [added]]);
    });

    it("remembers for five minutes that a paint does not exist", async () => {
        const { clock, kv, background, known, ask, asked } = setup();
        const a = paintId(1);
        await ask([a]);
        await background.settle();
        assert.equal(kv.values.get(`d1:7tv.paint:${a}`)?.metadata.s, 404);

        clock.advance(299);
        assert.deepEqual(await (await ask([a])).json(), { data: { paints: { p0: null } } });
        assert.equal(asked().length, 1);

        clock.advance(2);
        known.set(a, paint(a));
        assert.deepEqual(await (await ask([a])).json(), { data: { paints: { p0: paint(a) } } });
    });

    it("refreshes day-old paints behind the answer", async () => {
        const { clock, background, known, ask, asked } = setup();
        const a = paintId(1);
        known.set(a, paint(a, "Before"));
        await ask([a]);
        await background.settle();

        clock.advance(86401);
        known.set(a, paint(a, "After"));
        const response = await ask([a]);
        assert.equal(cacheOf(response), "UPDATING; layer=memory");
        assert.deepEqual(await response.json(), { data: { paints: { p0: paint(a, "Before") } } });
        await background.settle();
        assert.deepEqual(await (await ask([a])).json(), {
            data: { paints: { p0: paint(a, "After") } },
        });
        assert.equal(asked().length, 2);
    });

    const failures: [string, () => Response][] = [
        ["a 500", () => jsonResponse({}, 500)],
        [
            "a GraphQL error",
            () => jsonResponse({ data: null, errors: [{ message: "Query is too complex." }] }),
        ],
        ["an answer without paints", () => jsonResponse({ data: {} })],
    ];
    for (const [name, answer] of failures) {
        it(`fails the request on ${name}, so that the client asks 7TV itself`, async () => {
            const { upstream, kv, background, known, ask } = setup();
            const [a, b] = [paintId(1), paintId(2)];
            known.set(a, paint(a));
            await ask([a]);
            await background.settle();

            upstream.answer(GQL, answer);
            const response = await ask([a, b]);
            assert.equal(response.status, 502);
            assert.equal(cacheOf(response), "ERROR");
            await background.settle();
            assert.deepEqual([...kv.values.keys()], [`d1:7tv.paint:${a}`]);
        });

        it(`serves stored paints on ${name}`, async () => {
            const { clock, upstream, background, known, ask } = setup();
            const a = paintId(1);
            known.set(a, paint(a));
            await ask([a]);
            await background.settle();

            clock.advance(9 * 86400);
            upstream.answer(GQL, answer);
            const response = await ask([a]);
            assert.equal(response.status, 200);
            assert.equal(cacheOf(response), "STALE; layer=memory");
            assert.deepEqual(await response.json(), { data: { paints: { p0: paint(a) } } });
        });
    }
});
