import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChannel } from "../src/lib/channel";

describe("parseChannel", () => {
    it("accepts a bare login and lowercases it", () => {
        assert.equal(parseChannel("  Zackrawrr "), "zackrawrr");
    });

    it("strips the @ and # people type out of habit", () => {
        assert.equal(parseChannel("@viewer_one"), "viewer_one");
        assert.equal(parseChannel("#viewer_one"), "viewer_one");
    });

    it("reads twitch.tv links, with or without scheme, path or query", () => {
        assert.equal(parseChannel("https://www.twitch.tv/zackrawrr"), "zackrawrr");
        assert.equal(parseChannel("twitch.tv/zackrawrr/videos?filter=all"), "zackrawrr");
        assert.equal(parseChannel("https://m.twitch.tv/zackrawrr/"), "zackrawrr");
    });

    it("rejects what cannot be a login", () => {
        assert.equal(parseChannel(""), undefined);
        assert.equal(parseChannel("two words"), undefined);
        assert.equal(parseChannel("name-with-dash"), undefined);
        assert.equal(parseChannel("a".repeat(26)), undefined);
        assert.equal(parseChannel("https://example.com/zackrawrr"), undefined);
    });
});
