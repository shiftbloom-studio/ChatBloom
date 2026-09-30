import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleApi } from "../../src/worker/api";
import type { Env } from "../../src/worker/env";
import { shardOf } from "../../src/worker/relay/shard";

/** Node refuses to construct a response with status 101; the router only reads the status. */
const UPGRADED = { status: 101 } as Response;
const UPGRADE = { upgrade: "websocket" };
/** An upgrade from a client address, which the rate limit counts. */
const COUNTED = { ...UPGRADE, "cf-connecting-ip": "203.0.113.7" };
const CHANNEL = "/api/irc?channel=somechannel";
const DATA = "/api/data/bttv/3/cached/emotes/global";

/** What OBS 31 sends: its embedded Chromium, with the names of the tool appended. */
const BROWSER =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/127.0.0.0 Safari/537.36 OBS/31.0.3";

const CONTEXT = { waitUntil: () => {}, passThroughOnException: () => {} } as ExecutionContext;

/** Refused by the rate limit, under the keys the router counts this client by. */
const LIMITED = new Set(["irc:203.0.113.7", "data:203.0.113.7"]);

type HubAnswer = () => Response | Promise<Response>;

/** Bindings that record which hubs are asked. */
function fakeEnv(vars: Partial<Env> = {}, answer: HubAnswer = () => UPGRADED) {
    const hubs: string[] = [];
    const hub = (name: string) => {
        hubs.push(name);
        return { fetch: async () => answer() };
    };
    const limit = async ({ key }: { key: string }) => ({ success: !LIMITED.has(key) });
    const env = {
        CHAT_HUB: { idFromName: (name: string) => name, get: hub },
        RATE_LIMIT: { limit },
        ...vars,
    } as unknown as Env;
    return { env, hubs };
}

function call(env: Env, path: string, headers: Record<string, string> = UPGRADE, method = "GET") {
    const url = new URL(path, "https://chat.example");
    const request = new Request(url, { method, headers: { "user-agent": BROWSER, ...headers } });
    return handleApi(request, env, CONTEXT, url);
}

async function refusal(response: Promise<Response>) {
    const answer = await response;
    return [answer.status, ((await answer.json()) as { error: string }).error];
}

describe("handleApi", () => {
    it("refuses in a fixed order, before a hub or the gateway is asked", async () => {
        const { env, hubs } = fakeEnv();
        const off = { ...env, RELAY_ENABLED: "false" } as Env;
        const foreign = { ...UPGRADE, origin: "https://elsewhere.example" };
        // Refused for being a script although nothing else about the request is right.
        const script = { origin: "https://elsewhere.example", "user-agent": "curl/8.7.1" };
        const cases: [Env, string, Record<string, string>, string, number, string][] = [
            [off, "/api/irc", script, "POST", 403, "automated_client"],
            [off, "/api/irc", UPGRADE, "POST", 405, "method_not_allowed"],
            [off, "/api/irc", {}, "GET", 426, "upgrade_required"],
            [off, "/api/irc", foreign, "GET", 503, "relay_disabled"],
            [env, "/api/irc", foreign, "GET", 403, "foreign_origin"],
            [env, `/api/irc?channel=${"a".repeat(26)}`, UPGRADE, "GET", 400, "invalid_channel"],
            [env, CHANNEL, COUNTED, "GET", 429, "rate_limited"],
            [env, DATA, { "user-agent": "python-requests/2.32" }, "GET", 403, "automated_client"],
            [env, DATA, COUNTED, "GET", 429, "rate_limited"],
        ];
        for (const [on, path, headers, method, status, error] of cases) {
            assert.deepEqual(await refusal(call(on, path, headers, method)), [status, error], path);
        }
        assert.equal(hubs.length, 0);
    });

    it("lets the page's origin, or none, reach the shard of the channel", async () => {
        const { env, hubs } = fakeEnv();
        const path = "/api/irc?channel=SomeChannel";
        for (const origin of ["https://chat.example", "null"]) {
            assert.equal(await call(env, path, { ...UPGRADE, origin }), UPGRADED, origin);
            // The case of a name makes no other channel: one channel, one shard.
            assert.equal(hubs.at(-1), `hub-${shardOf("somechannel", 4)}`);
        }
    });

    it("serves chat when the rate limit or the counters fail", async (t) => {
        t.mock.method(console, "warn", () => {});
        const broken = () => {
            throw new Error("binding unavailable");
        };
        const bindings = { RATE_LIMIT: { limit: broken }, ANALYTICS: { writeDataPoint: broken } };
        const { env } = fakeEnv(bindings as unknown as Partial<Env>);
        assert.equal(await call(env, CHANNEL, COUNTED), UPGRADED);
    });

    it("answers 503 when a hub fails, hangs or does not upgrade, and hands on its refusal", async (t) => {
        t.mock.method(console, "error", () => {});
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const failures = [
            () => Promise.reject(new Error("Durable Object is overloaded")),
            () => new Response("{}"),
            () => new Promise<Response>(() => {}),
        ];
        for (const answer of failures) {
            const response = call(fakeEnv({}, answer).env, CHANNEL);
            // The hub is asked after the rate limit was, which takes a turn of the event loop.
            await new Promise((resolve) => setImmediate(resolve));
            t.mock.timers.tick(5000);
            assert.deepEqual(await refusal(response), [503, "relay_unavailable"]);
        }
        const full = Response.json({ error: "hub_full" }, { status: 503 });
        assert.equal(await call(fakeEnv({}, () => full).env, CHANNEL), full);
    });
});
