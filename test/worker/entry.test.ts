import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import type { Env } from "../../src/worker/env";

// The build points this name at the Worker that Nitro generates. Here it is a stand-in that
// says what reached it.
const NITRO_WORKER = `data:text/javascript,export default {
    fetch: (request) => new Response("nitro " + new URL(request.url).pathname),
    scheduled: () => "nitro scheduled",
};`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "#petal/nitro-worker") {
            return { url: NITRO_WORKER, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const entry = await import("../../src/worker/entry");

const CONTEXT = {
    waitUntil: () => {},
    passThroughOnException: () => {},
} as unknown as ExecutionContext;

function fetchFrom(path: string): Promise<Response> {
    const request = new Request(new URL(path, "https://chat.example"));
    return Promise.resolve(
        entry.default.fetch(
            request as Parameters<typeof entry.default.fetch>[0],
            {} as Env,
            CONTEXT,
        ),
    );
}

describe("the Worker entry", () => {
    it("answers /api/ itself", async () => {
        const response = await fetchFrom("/api/unknown");
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "not_found" });
    });

    it("leaves everything else to Nitro", async () => {
        for (const path of ["/", "/setup", "/chat/somechannel", "/api", "/apix", "/API/status"]) {
            const response = await fetchFrom(path);
            assert.equal(await response.text(), `nitro ${path}`);
        }
    });

    it("keeps the other handlers of Nitro's Worker", () => {
        const handlers = entry.default as unknown as { scheduled(): string };
        assert.equal(handlers.scheduled(), "nitro scheduled");
    });

    it("exports the Durable Object class that wrangler.jsonc binds", () => {
        assert.equal(typeof entry.ChatHub, "function");
        assert.equal(entry.ChatHub.name, "ChatHub");
    });
});
