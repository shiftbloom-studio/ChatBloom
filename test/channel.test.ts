import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChannel } from "../src/lib/channel";

describe("parseChannel", () => {
    it("reads what streamers paste, and nothing that leads elsewhere", () => {
        const cases: [string, string | undefined][] = [
            ["  Zackrawrr ", "zackrawrr"],
            ["@viewer_one", "viewer_one"],
            ["#viewer_one", "viewer_one"],
            ["twitch.tv/zackrawrr/videos?filter=all", "zackrawrr"],
            ["HTTPS://WWW.TWITCH.TV/ZACKRAWRR", "zackrawrr"],
            ["https://m.twitch.tv/zackrawrr/", "zackrawrr"],
            ["https://www.twitch.tv/popout/zackrawrr/chat?popout=", "zackrawrr"],
            ["https://dashboard.twitch.tv/u/zackrawrr/stream-manager", "zackrawrr"],
            // Links to no channel, or to another site, must not become one.
            ["https://www.twitch.tv/", undefined],
            ["https://www.twitch.tv/directory/category/just-chatting", undefined],
            ["https://www.twitch.tv/videos/123456789", undefined],
            ["https://nottwitch.tv/zackrawrr", undefined],
            ["https://twitch.tv.example.com/zackrawrr", undefined],
            ["https://example.com/twitch.tv/zackrawrr", undefined],
            ["", undefined],
            ["two words", undefined],
            ["name-with-dash", undefined],
            ["a".repeat(26), undefined],
        ];
        for (const [input, login] of cases) {
            assert.equal(parseChannel(input), login, JSON.stringify(input));
        }
    });
});
