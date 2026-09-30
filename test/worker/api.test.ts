import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { type ApiHandlers, handleApi, relayEnabled, shardCount } from "../../src/worker/api";
import type { Env } from "../../src/worker/env";
import { shardOf } from "../../src/worker/relay/shard";

interface HubCall {
    hub: string;
    hint: string | undefined;
    input: Request | string;
}

interface DataPoint {
    indexes: string[];
    blobs: string[];
    doubles: number[];
}

type HubAnswer = (hub: string, input: Request | string) => Response | Promise<Response>;

/** Node refuses to construct a response with status 101; the router only reads the status. */
const UPGRADED = { status: 101 } as Response;

const UPGRADE = { upgrade: "websocket" };

/** A crawler, a command line tool, a library, and a client that does not say what it is. */
const AUTOMATED = [
    "Mozilla/5.0 (compatible; GPTBot/1.2)",
    "curl/8.7.1",
    "python-requests/2.32",
    "",
];

/** What OBS 31 sends: its embedded Chromium, with the names of the tool appended. */
const BROWSER =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/127.0.0.0 Safari/537.36 OBS/31.0.3";

const CONTEXT = {
    waitUntil: () => {},
    passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** Bindings that record what the router does with them. */
function fakeEnv(
    vars: Partial<Env> = {},
    options: { answer?: HubAnswer; limit?: (key: string) => boolean } = {},
) {
    const calls: HubCall[] = [];
    const points: DataPoint[] = [];
    const keys: string[] = [];
    const answer = options.answer ?? (() => UPGRADED);
    const namespace = {
        idFromName: (name: string) => name,
        get: (hub: string, stubOptions?: { locationHint?: string }) => ({
            fetch: async (input: Request | string) => {
                calls.push({ hub, hint: stubOptions?.locationHint, input });
                return answer(hub, input);
            },
        }),
    };
    const limit = options.limit;
    const env = {
        CHAT_HUB: namespace,
        ANALYTICS: { writeDataPoint: (point: DataPoint) => points.push(point) },
        RATE_LIMIT: limit && {
            limit: async ({ key }: { key: string }) => {
                keys.push(key);
                return { success: limit(key) };
            },
        },
        ...vars,
    } as unknown as Env;
    return { env, calls, points, keys };
}

function call(
    env: Env,
    path: string,
    init: { method?: string; headers?: Record<string, string> } = {},
    handlers?: ApiHandlers,
) {
    const url = new URL(path, "https://chat.example");
    const headers = { "user-agent": BROWSER, ...init.headers };
    const request = new Request(url, { ...init, headers });
    return { request, response: handleApi(request, env, CONTEXT, url, handlers) };
}

async function refusal(response: Promise<Response>) {
    const answer = await response;
    assert.equal(answer.headers.get("cache-control"), "no-store");
    assert.match(answer.headers.get("content-type") ?? "", /^application\/json/);
    const body = (await answer.json()) as { error: string };
    return { status: answer.status, error: body.error, headers: answer.headers };
}

function silence(t: TestContext) {
    return t.mock.method(console, "error", () => {});
}

describe("relayEnabled", () => {
    it("is on unless the switch says otherwise", () => {
        for (const value of [undefined, "", "true", "1", "yes"]) {
            assert.equal(relayEnabled({ RELAY_ENABLED: value } as Env), true, String(value));
        }
        for (const value of ["false", "FALSE", " false ", "0", "off", "no"]) {
            assert.equal(relayEnabled({ RELAY_ENABLED: value } as Env), false, value);
        }
    });
});

describe("shardCount", () => {
    it("falls back to four shards for anything but a sensible number", () => {
        assert.equal(shardCount({ RELAY_SHARDS: "8" } as Env), 8);
        assert.equal(shardCount({ RELAY_SHARDS: " 1 " } as Env), 1);
        for (const value of [undefined, "", "0", "-2", "1.5", "4 shards", "65", "1e3"]) {
            assert.equal(shardCount({ RELAY_SHARDS: value } as Env), 4, String(value));
        }
    });
});

describe("routing", () => {
    it("answers what it does not know with a JSON 404", async () => {
        const { env, calls } = fakeEnv();
        for (const path of ["/api/", "/api/unknown", "/api/irc/", "/api/status/x", "/api/data"]) {
            const { status, error } = await refusal(call(env, path, { headers: UPGRADE }).response);
            assert.equal(status, 404, path);
            assert.equal(error, "not_found");
        }
        assert.equal(calls.length, 0);
    });

    it("hands everything under /api/data/ to the gateway and counts what it reports", async () => {
        const { env, points, calls } = fakeEnv();
        const seen: { request: Request; env: Env; context: ExecutionContext; url: URL }[] = [];
        const answer = new Response("{}", { headers: { "x-petal-cache": "HIT" } });
        const handlers: ApiHandlers = {
            data: async (request, gatewayEnv, context, url, onEvent) => {
                seen.push({ request, env: gatewayEnv as Env, context, url });
                onEvent?.({ route: "bttv-global", outcome: "HIT", layer: "memory", status: 200 });
                return answer;
            },
        };
        const { request, response } = call(
            env,
            "/api/data/bttv/3/cached/emotes/global?x=1",
            { method: "POST" },
            handlers,
        );
        assert.equal(await response, answer);
        assert.equal(seen.length, 1);
        assert.equal(seen[0]?.request, request);
        assert.equal(seen[0]?.env, env);
        assert.equal(seen[0]?.context, CONTEXT);
        assert.equal(seen[0]?.url.pathname, "/api/data/bttv/3/cached/emotes/global");
        assert.deepEqual(points, [
            {
                indexes: ["data"],
                blobs: ["data", "bttv-global", "HIT", "memory"],
                doubles: [200],
            },
        ]);
        assert.equal(calls.length, 0);
    });

    it("refuses crawlers and scripts before the gateway is asked", async () => {
        const { env, points } = fakeEnv();
        let asked = 0;
        const handlers: ApiHandlers = {
            data: async () => {
                asked++;
                return new Response("{}");
            },
        };
        for (const agent of AUTOMATED) {
            const headers = { "user-agent": agent };
            const path = "/api/data/bttv/3/cached/emotes/global";
            const answer = await refusal(call(env, path, { headers }, handlers).response);
            assert.equal(answer.status, 403, agent);
            assert.equal(answer.error, "automated_client");
            // The overlay of a browser that was taken for a script asks the provider itself.
            assert.equal(answer.headers.get("x-petal-cache"), "ERROR");
        }
        assert.equal(asked, 0);
        assert.deepEqual(
            points.map((point) => [point.indexes, point.blobs, point.doubles]),
            AUTOMATED.map(() => [["data"], ["data", "none", "REFUSED", ""], [403]]),
        );
    });

    it("reaches the gateway that is built in", async () => {
        const { env } = fakeEnv();
        const answer = await call(env, "/api/data/nowhere/at/all").response;
        assert.ok(answer.status >= 400 && answer.status < 500, String(answer.status));
        assert.ok(answer.headers.get("x-petal-cache"));
        assert.equal(answer.headers.get("cache-control"), "no-store");
    });

    it("answers 503 in the gateway's manner when the gateway throws", async (t) => {
        const logged = silence(t);
        const { env } = fakeEnv();
        const handlers: ApiHandlers = {
            data: async () => {
                throw new Error("boom");
            },
        };
        const path = "/api/data/7tv/v3/users/twitch/12345";
        const { status, headers } = await refusal(call(env, path, {}, handlers).response);
        assert.equal(status, 503);
        assert.equal(headers.get("x-petal-cache"), "ERROR");
        assert.equal(logged.mock.callCount(), 1);
        assert.ok(!JSON.stringify(logged.mock.calls[0]?.arguments).includes("12345"));
    });

    it("answers instead of throwing when the relay is not bound", async (t) => {
        silence(t);
        const unbound = { RELAY_SHARDS: "1" } as Env;
        const { response } = call(unbound, "/api/irc?channel=somechannel", { headers: UPGRADE });
        const { status, headers } = await refusal(response);
        assert.equal(status, 503);
        assert.equal(headers.get("x-petal-cache"), null);

        const report = await call(unbound, "/api/status").response;
        assert.equal(report.status, 200);
        assert.deepEqual(await report.json(), {
            version: null,
            relayEnabled: true,
            relayPaused: false,
            shards: [{ shard: 0, available: false }],
        });
    });
});

describe("/api/irc", () => {
    it("sends the upgrade to the shard of its channel, near the streamers", async () => {
        const { env, calls, points } = fakeEnv({ RELAY_SHARDS: "8" });
        const first = call(env, "/api/irc?channel=SomeChannel", { headers: UPGRADE });
        const second = call(env, "/api/irc?channel=somechannel", {
            headers: { upgrade: "WebSocket" },
        });
        assert.equal(await first.response, UPGRADED);
        assert.equal(await second.response, UPGRADED);

        const shard = shardOf("somechannel", 8);
        assert.deepEqual(
            calls.map(({ hub, hint }) => ({ hub, hint })),
            [
                { hub: `hub-${shard}`, hint: "weur" },
                { hub: `hub-${shard}`, hint: "weur" },
            ],
        );
        // The hub reads the channel from the request it is handed.
        assert.equal(calls[0]?.input, first.request);
        assert.equal(calls[1]?.input, second.request);
        const connect = { indexes: ["irc-connect"], blobs: ["irc-connect"], doubles: [shard] };
        assert.deepEqual(points, [connect, connect]);
    });

    it("spreads channels over all shards", async () => {
        const { env, calls } = fakeEnv({ RELAY_SHARDS: "4" });
        for (let index = 0; index < 64; index++) {
            await call(env, `/api/irc?channel=channel_${index}`, { headers: UPGRADE }).response;
        }
        const hubs = new Set(calls.map((entry) => entry.hub));
        assert.deepEqual([...hubs].sort(), ["hub-0", "hub-1", "hub-2", "hub-3"]);
    });

    it("refuses in a fixed order and before the hub is asked", async () => {
        const { env, calls, points, keys } = fakeEnv({}, { limit: () => false });
        const off = { ...env, RELAY_ENABLED: "false" } as Env;
        const foreign = { ...UPGRADE, origin: "https://elsewhere.example" };
        // Refused for being a script although nothing else about the request is right.
        const script = { origin: "https://elsewhere.example", "user-agent": "curl/8.7.1" };
        const known = { ...UPGRADE, "cf-connecting-ip": "203.0.113.7" };
        const cases: [Env, string, Parameters<typeof call>[2], number, string][] = [
            [off, "/api/irc", { method: "POST", headers: script }, 403, "automated_client"],
            [off, "/api/irc", { method: "POST", headers: UPGRADE }, 405, "method_not_allowed"],
            [off, "/api/irc", {}, 426, "upgrade_required"],
            [off, "/api/irc", { headers: foreign }, 503, "relay_disabled"],
            [env, "/api/irc", { headers: foreign }, 403, "foreign_origin"],
            [env, "/api/irc", { headers: UPGRADE }, 400, "invalid_channel"],
            [env, "/api/irc?channel=", { headers: UPGRADE }, 400, "invalid_channel"],
            [env, "/api/irc?channel=no%20spaces", { headers: UPGRADE }, 400, "invalid_channel"],
            [
                env,
                `/api/irc?channel=${"a".repeat(26)}`,
                { headers: UPGRADE },
                400,
                "invalid_channel",
            ],
            [env, "/api/irc?channel=somechannel", { headers: known }, 429, "rate_limited"],
        ];
        for (const [bindings, path, init, expected, code] of cases) {
            const { status, error } = await refusal(call(bindings, path, init).response);
            assert.equal(status, expected, `${code} for ${path}`);
            assert.equal(error, code);
        }
        assert.equal(calls.length, 0);
        // Asked last, and only with a client address to count by.
        assert.deepEqual(keys, ["irc:203.0.113.7"]);
        assert.deepEqual(
            points.map((point) => [point.indexes, point.blobs, point.doubles]),
            cases.map(([, , , status, code]) => [["irc-refused"], ["irc-refused", code], [status]]),
        );
    });

    it("refuses crawlers and scripts, which get no chat page either", async () => {
        const { env, calls } = fakeEnv();
        for (const agent of AUTOMATED) {
            const headers = { ...UPGRADE, "user-agent": agent };
            const { response } = call(env, "/api/irc?channel=somechannel", { headers });
            const { status, error } = await refusal(response);
            assert.equal(status, 403, agent);
            assert.equal(error, "automated_client");
        }
        assert.equal(calls.length, 0);
    });

    it("lets the page's own origin and clients without one pass", async () => {
        const { env, calls } = fakeEnv();
        const origins = ["https://chat.example", "null"];
        for (const origin of origins) {
            const headers = { ...UPGRADE, origin };
            const { response } = call(env, "/api/irc?channel=somechannel", { headers });
            assert.equal(await response, UPGRADED, origin);
        }
        assert.equal(calls.length, origins.length);
    });

    it("counts connects per client address", async () => {
        const allowed = new Set(["irc:203.0.113.7"]);
        const { env, calls, keys } = fakeEnv({}, { limit: (key) => allowed.has(key) });
        const path = "/api/irc?channel=somechannel";
        const from = (address: string) => ({ ...UPGRADE, "cf-connecting-ip": address });

        assert.equal(await call(env, path, { headers: from("203.0.113.7") }).response, UPGRADED);
        const refused = await refusal(call(env, path, { headers: from("203.0.113.8") }).response);
        assert.equal(refused.status, 429);
        assert.equal(refused.headers.get("retry-after"), "60");
        assert.deepEqual(keys, ["irc:203.0.113.7", "irc:203.0.113.8"]);
        assert.equal(calls.length, 1);
    });

    it("serves chat when the rate limit or the counters fail", async (t) => {
        t.mock.method(console, "warn", () => {});
        const { env, calls } = fakeEnv({
            RATE_LIMIT: {
                limit: async () => {
                    throw new Error("rate limit unavailable");
                },
            },
            ANALYTICS: {
                writeDataPoint: () => {
                    throw new Error("analytics unavailable");
                },
            },
        } as unknown as Partial<Env>);
        const headers = { ...UPGRADE, "cf-connecting-ip": "203.0.113.7" };
        const { response } = call(env, "/api/irc?channel=somechannel", { headers });
        assert.equal(await response, UPGRADED);
        assert.equal(calls.length, 1);
    });

    it("answers 503 when the hub fails or does not upgrade", async (t) => {
        const logged = silence(t);
        const answers: HubAnswer[] = [
            () => {
                throw new Error("Durable Object is overloaded");
            },
            () => new Response("{}"),
        ];
        const shard = shardOf("somechannel", 4);
        for (const answer of answers) {
            const { env, points } = fakeEnv({}, { answer });
            const { response } = call(env, "/api/irc?channel=somechannel", { headers: UPGRADE });
            const { status, error } = await refusal(response);
            assert.equal(status, 503);
            assert.equal(error, "relay_unavailable");
            assert.deepEqual(points, [
                {
                    indexes: ["irc-refused"],
                    blobs: ["irc-refused", "relay_unavailable"],
                    doubles: [503, shard],
                },
            ]);
        }
        assert.equal(logged.mock.callCount(), answers.length);
        assert.ok(!JSON.stringify(logged.mock.calls).includes("somechannel"));
    });

    it("hands on what a hub refuses with, and counts it without logging", async (t) => {
        const logged = silence(t);
        const full = new Response('{"error":"hub_full"}', {
            status: 503,
            headers: { "cache-control": "no-store", "retry-after": "30" },
        });
        const { env, points } = fakeEnv({}, { answer: () => full });
        const { response } = call(env, "/api/irc?channel=somechannel", { headers: UPGRADE });
        assert.equal(await response, full);
        assert.deepEqual(points, [
            {
                indexes: ["irc-refused"],
                blobs: ["irc-refused", "hub_refused"],
                doubles: [503, shardOf("somechannel", 4)],
            },
        ]);
        assert.equal(logged.mock.callCount(), 0);
    });

    it("hands on the refusal of a hub that has paused itself, with the time it names", async () => {
        const paused = new Response('{"error":"relay_paused"}', {
            status: 503,
            headers: {
                "cache-control": "no-store",
                "content-type": "application/json; charset=utf-8",
                "retry-after": "840",
            },
        });
        const { env, points } = fakeEnv({}, { answer: () => paused });
        const { response } = call(env, "/api/irc?channel=somechannel", { headers: UPGRADE });
        assert.equal(await response, paused);
        const { status, error, headers } = await refusal(response);
        assert.equal(status, 503);
        assert.equal(error, "relay_paused");
        assert.equal(headers.get("retry-after"), "840");
        assert.deepEqual(points, [
            {
                indexes: ["irc-refused"],
                blobs: ["irc-refused", "hub_refused"],
                doubles: [503, shardOf("somechannel", 4)],
            },
        ]);
    });

    it("does not wait for a hub that hangs", async (t) => {
        silence(t);
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { env } = fakeEnv({}, { answer: () => new Promise<Response>(() => {}) });
        const { response } = call(env, "/api/irc?channel=somechannel", { headers: UPGRADE });
        // The hub is asked after the rate limit was, which takes a turn of the event loop.
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(5000);
        assert.equal((await refusal(response)).status, 503);
    });
});

describe("/api/status", () => {
    const version = { id: "version-id", tag: "", timestamp: "2026-09-29T20:00:00Z" };

    it("reports the deployment, the switch and every shard, and is never cached", async () => {
        const answer: HubAnswer = (hub) => Response.json({ shard: "9", clients: hub.length });
        const { env, calls, points } = fakeEnv(
            { RELAY_SHARDS: "2", CF_VERSION_METADATA: version },
            { answer },
        );
        const response = await call(env, "/api/status").response;
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), {
            version,
            relayEnabled: true,
            relayPaused: false,
            shards: [
                { shard: 0, available: true, clients: 5 },
                { shard: 1, available: true, clients: 5 },
            ],
        });
        assert.deepEqual(
            calls.map(({ hub, hint, input }) => ({ hub, hint, input })),
            [
                { hub: "hub-0", hint: "weur", input: "https://hub/api/status?shard=0" },
                { hub: "hub-1", hint: "weur", input: "https://hub/api/status?shard=1" },
            ],
        );
        assert.deepEqual(points, []);
    });

    it("reports a failing hub as unavailable and the others as they are", async (t) => {
        const logged = silence(t);
        const answer: HubAnswer = (hub) => {
            if (hub === "hub-1") throw new Error("Durable Object is overloaded");
            if (hub === "hub-2") return new Response("broken", { status: 500 });
            if (hub === "hub-3") return new Response("not json");
            return Response.json({ clients: 3 });
        };
        const { env } = fakeEnv({ RELAY_ENABLED: "false" }, { answer });
        const response = await call(env, "/api/status").response;
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            version: null,
            relayEnabled: false,
            relayPaused: false,
            shards: [
                { shard: 0, available: true, clients: 3 },
                { shard: 1, available: false },
                { shard: 2, available: false },
                { shard: 3, available: false },
            ],
        });
        assert.equal(logged.mock.callCount(), 3);
    });

    it("says that a hub has paused itself, also while another hub does not answer", async (t) => {
        const logged = silence(t);
        const pause = { reason: "connects", remainingMs: 840_000 };
        const answer: HubAnswer = (hub) => {
            if (hub === "hub-0") throw new Error("Durable Object is overloaded");
            return Response.json({ clients: 0, pause: hub === "hub-2" ? pause : null });
        };
        const { env } = fakeEnv({ RELAY_SHARDS: "3" }, { answer });
        const response = await call(env, "/api/status").response;
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            version: null,
            relayEnabled: true,
            relayPaused: true,
            shards: [
                { shard: 0, available: false },
                { shard: 1, available: true, clients: 0, pause: null },
                { shard: 2, available: true, clients: 0, pause },
            ],
        });
        assert.equal(logged.mock.callCount(), 1);
    });

    it("reports a hub that hangs as unavailable", async (t) => {
        silence(t);
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const answer: HubAnswer = (hub) =>
            hub === "hub-0" ? new Promise<Response>(() => {}) : Response.json({ clients: 1 });
        const { env } = fakeEnv({ RELAY_SHARDS: "2" }, { answer });
        const { response } = call(env, "/api/status");
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(3000);
        const body = (await (await response).json()) as { shards: unknown[] };
        assert.deepEqual(body.shards, [
            { shard: 0, available: false },
            { shard: 1, available: true, clients: 1 },
        ]);
    });

    it("answers scripts as well, since a monitor is one", async () => {
        const { env } = fakeEnv({ RELAY_SHARDS: "1" }, { answer: () => Response.json({}) });
        for (const agent of AUTOMATED) {
            const headers = { "user-agent": agent };
            const answer = await call(env, "/api/status", { headers }).response;
            assert.equal(answer.status, 200, agent);
        }
    });

    it("answers GET only and is rate limited by client address", async () => {
        const { env, calls, keys } = fakeEnv({}, { limit: () => false });
        const post = await refusal(call(env, "/api/status", { method: "POST" }).response);
        assert.equal(post.status, 405);
        assert.equal(post.headers.get("allow"), "GET");

        const headers = { "cf-connecting-ip": "203.0.113.7" };
        const limited = await refusal(call(env, "/api/status", { headers }).response);
        assert.equal(limited.status, 429);
        assert.deepEqual(keys, ["status:203.0.113.7"]);
        assert.equal(calls.length, 0);
    });
});
