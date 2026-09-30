import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normaliseChannel, shardOf, stableHash } from "../../../src/worker/relay/shard";

describe("shard routing", () => {
    // Computed with an independent implementation. If one of these changes, overlays are
    // sent to another hub than the one that holds their channel.
    it("keeps the hash and the shard of a channel for every shard count", () => {
        const pinned: [string, number, number[]][] = [
            ["petal", 2987140979, [0, 1, 3, 3, 3]],
            ["some_channel_123", 3543465314, [0, 0, 2, 2, 2]],
            ["x", 4245442695, [0, 1, 3, 7, 7]],
            ["0123456789abcdefghijklmno", 502461414, [0, 0, 2, 6, 6]],
        ];
        for (const [channel, hash, shards] of pinned) {
            assert.equal(stableHash(channel), hash, channel);
            const found = [1, 2, 4, 8, 16].map((count) => shardOf(channel, count));
            assert.deepEqual(found, shards, channel);
            assert.equal(shardOf(channel.toUpperCase(), 16), shards[4], channel);
        }
        for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            assert.equal(shardOf("petal", count), 0);
        }
    });

    it("normalises a channel and refuses what cannot be a Twitch login", () => {
        assert.equal(normaliseChannel("#Petal"), "petal");
        const refused = ["", "#", "##a", "a".repeat(26), "a b", "a,b", "a\r\nJOIN #b", "ä", null];
        for (const raw of refused) assert.equal(normaliseChannel(raw), undefined, String(raw));
    });
});
