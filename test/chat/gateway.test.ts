import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";

import { fetchJson } from "../../src/lib/chat/gateway";
import { type FetchAnswer, stubFetch, useLocation } from "../helpers";

const PROVIDER = "https://api.betterttv.net/3/cached/users/twitch/1";
const GATEWAY = "https://chat.shiftbloom.studio/api/data/bttv/3/cached/users/twitch/1";
const ANSWER = { channelEmotes: [], sharedEmotes: [] };

/** Every answer of the gateway carries this header, whatever its status. */
const gateway =
    (status: number, body = "{}"): FetchAnswer =>
    () =>
        new Response(body, { status, headers: { "x-petal-cache": "HIT; layer=memory" } });

function stub(t: TestContext, answer: unknown) {
    t.mock.method(console, "warn", () => {});
    t.after(useLocation("https://chat.shiftbloom.studio/chat/forsen"));
    const fetches = stubFetch({ [GATEWAY]: answer, [PROVIDER]: ANSWER });
    t.after(fetches);
    return () => fetches.calls.map((call) => call.url);
}

for (const [when, answer, result, asked] of [
    ["answers", gateway(200, JSON.stringify(ANSWER)), ANSWER, [GATEWAY]],
    ["answers 404, the provider's answer", gateway(404), undefined, [GATEWAY]],
    // Whenever the gateway fails, the provider is asked directly, as before there was a gateway.
    ["cannot be reached", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["answers 429", gateway(429)],
    ["answers 503", gateway(503)],
    ["refuses the request", gateway(400)],
    ["gives an answer that cannot be read", gateway(200, "<!doctype html>")],
    // A rate limit in front of the Worker, or a deployment without the gateway, lacks the header.
    ["is not what answers 429", 429],
    ["is not what answers 404", 404],
] as [string, unknown, unknown?, string[]?][]) {
    it(`fetchJson when the gateway ${when}`, async (t) => {
        const urls = stub(t, answer);
        assert.deepEqual(await fetchJson(PROVIDER), asked ? result : ANSWER);
        assert.deepEqual(urls(), asked ?? [GATEWAY, PROVIDER]);
    });
}

it("asks the provider when the gateway has not answered after 8 seconds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    /** Never answers, and fails like fetch() does once the request is aborted. */
    const hangs: FetchAnswer = (init) =>
        new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
    const urls = stub(t, hangs);
    const result = fetchJson(PROVIDER);
    t.mock.timers.tick(7999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(urls(), [GATEWAY]);
    t.mock.timers.tick(1);
    assert.deepEqual(await result, ANSWER);
});
