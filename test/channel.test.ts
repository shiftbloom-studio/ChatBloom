import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChannel } from "../src/lib/channel";

describe("parseChannel", () => {
    it("accepts a bare login and lowercases it", () => {
        assert.equal(parseChannel("  Zackrawrr "), "zackrawrr");
        assert.equal(parseChannel("SOMECHANNEL42"), "somechannel42");
        assert.equal(parseChannel("\tsome_channel \n"), "some_channel");
    });

    it("strips the @ and # people type out of habit", () => {
        assert.equal(parseChannel("@viewer_one"), "viewer_one");
        assert.equal(parseChannel("#viewer_one"), "viewer_one");
    });

    it("reads twitch.tv links, with or without scheme, path or query", () => {
        assert.equal(parseChannel("https://www.twitch.tv/zackrawrr"), "zackrawrr");
        assert.equal(parseChannel("twitch.tv/zackrawrr/videos?filter=all"), "zackrawrr");
        assert.equal(parseChannel("https://m.twitch.tv/zackrawrr/"), "zackrawrr");
        assert.equal(parseChannel("HTTPS://WWW.TWITCH.TV/ZACKRAWRR"), "zackrawrr");
        assert.equal(parseChannel("www.twitch.tv/zackrawrr#chat"), "zackrawrr");
        assert.equal(parseChannel("https://www.twitch.tv//zackrawrr"), "zackrawrr");
    });

    it("reads links to the chat, the mod view and the dashboard of a channel", () => {
        for (const link of [
            "https://www.twitch.tv/popout/zackrawrr/chat?popout=",
            "https://www.twitch.tv/embed/zackrawrr/chat",
            "https://www.twitch.tv/moderator/zackrawrr",
            "https://dashboard.twitch.tv/u/zackrawrr/stream-manager",
        ]) {
            assert.equal(parseChannel(link), "zackrawrr", link);
        }
    });

    it("rejects links that lead to no channel", () => {
        for (const link of [
            "twitch.tv",
            "https://www.twitch.tv/",
            "https://www.twitch.tv/?lang=de",
            "https://www.twitch.tv/directory/category/just-chatting",
            "https://www.twitch.tv/videos/123456789",
            "https://www.twitch.tv/settings/profile",
            "https://www.twitch.tv/popout/",
            "https://www.twitch.tv/bad-name",
        ]) {
            assert.equal(parseChannel(link), undefined, link);
        }
    });

    it("rejects links to other sites", () => {
        for (const link of [
            "https://example.com/zackrawrr",
            "https://nottwitch.tv/zackrawrr",
            "https://twitch.tv.example.com/zackrawrr",
            "https://example.com/twitch.tv/zackrawrr",
        ]) {
            assert.equal(parseChannel(link), undefined, link);
        }
    });

    it("rejects what cannot be a login", () => {
        for (const input of [
            "",
            "   ",
            "#",
            "#@both",
            "two words",
            "name-with-dash",
            "bad.name",
            "ümlaut",
            "a/b",
            "name?x=1",
            "a".repeat(26),
        ]) {
            assert.equal(parseChannel(input), undefined, JSON.stringify(input));
        }
    });
});
