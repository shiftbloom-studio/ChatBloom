import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withinLimit } from "../../src/worker/rate-limit";

function limiter(answer: (key: string) => boolean) {
    const keys: string[] = [];
    const binding = {
        limit: async ({ key }: { key: string }) => {
            keys.push(key);
            return { success: answer(key) };
        },
    } as RateLimit;
    return { binding, keys };
}

function from(address?: string): Request {
    return new Request("https://chat.example/api/irc", {
        headers: address ? { "cf-connecting-ip": address } : {},
    });
}

describe("withinLimit", () => {
    it("counts per scope and client address", async () => {
        const { binding, keys } = limiter((key) => key !== "irc:203.0.113.7");
        assert.equal(await withinLimit(binding, "irc", from("203.0.113.7")), false);
        assert.equal(await withinLimit(binding, "data", from("203.0.113.7")), true);
        assert.equal(await withinLimit(binding, "irc", from("2001:db8::7")), true);
        assert.deepEqual(keys, ["irc:203.0.113.7", "data:203.0.113.7", "irc:2001:db8::7"]);
    });

    it("lets everybody pass without the binding or without an address", async () => {
        const { binding, keys } = limiter(() => false);
        assert.equal(await withinLimit(undefined, "irc", from("203.0.113.7")), true);
        assert.equal(await withinLimit(binding, "irc", from()), true);
        assert.deepEqual(keys, []);
    });

    it("lets everybody pass when the binding fails", async () => {
        const binding = {
            limit: async () => {
                throw new Error("rate limit unavailable");
            },
        } as RateLimit;
        assert.equal(await withinLimit(binding, "irc", from("203.0.113.7")), true);
    });
});
