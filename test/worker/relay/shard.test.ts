import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normaliseChannel, shardOf, stableHash } from "../../../src/worker/relay/shard";

describe("stableHash", () => {
    it("matches the FNV-1a reference values", () => {
        assert.equal(stableHash(""), 0x811c9dc5);
        assert.equal(stableHash("a"), 0xe40c292c);
        assert.equal(stableHash("foobar"), 0xbf9cf968);
    });

    // Computed with an independent implementation. If one of these changes, overlays are
    // sent to another hub than the one that holds their channel.
    it("keeps the values channels are routed by", () => {
        assert.equal(stableHash("chatbloom"), 2526141514);
        assert.equal(stableHash("some_channel_123"), 3543465314);
        assert.equal(stableHash("x"), 4245442695);
        assert.equal(stableHash("0123456789abcdefghijklmno"), 502461414);
    });
});

describe("shardOf", () => {
    it("keeps the shard of a channel for every shard count", () => {
        const shards = (channel: string) => [1, 2, 4, 8, 16].map((n) => shardOf(channel, n));
        assert.deepEqual(shards("chatbloom"), [0, 0, 2, 2, 10]);
        assert.deepEqual(shards("some_channel_123"), [0, 0, 2, 2, 2]);
        assert.deepEqual(shards("x"), [0, 1, 3, 7, 7]);
        assert.deepEqual(shards("0123456789abcdefghijklmno"), [0, 0, 2, 6, 6]);
    });

    it("ignores the case of the channel", () => {
        assert.equal(shardOf("ChatBloom", 16), shardOf("chatbloom", 16));
    });

    it("stays below the shard count", () => {
        for (let index = 0; index < 500; index++) {
            const shard = shardOf(`channel_${index}`, 7);
            assert.ok(Number.isInteger(shard) && shard >= 0 && shard < 7);
        }
    });

    it("spreads channels over all shards", () => {
        const used = new Set<number>();
        for (let index = 0; index < 200; index++) used.add(shardOf(`channel_${index}`, 4));
        assert.equal(used.size, 4);
    });

    it("answers with the first shard when the count is unusable", () => {
        for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            assert.equal(shardOf("chatbloom", count), 0);
        }
    });
});

describe("normaliseChannel", () => {
    it("lowers the case and drops the leading hash", () => {
        assert.equal(normaliseChannel("ChatBloom"), "chatbloom");
        assert.equal(normaliseChannel("#chatbloom"), "chatbloom");
        assert.equal(normaliseChannel("a_1"), "a_1");
        assert.equal(normaliseChannel("a".repeat(25)), "a".repeat(25));
    });

    it("refuses what cannot be a Twitch login", () => {
        const refused = ["", "#", "##a", "a".repeat(26), "a b", "a,b", "a\r\nJOIN #b", "ä", "a-b"];
        for (const raw of refused) assert.equal(normaliseChannel(raw), undefined, raw);
        assert.equal(normaliseChannel(null), undefined);
        assert.equal(normaliseChannel(undefined), undefined);
    });
});
