import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    parseAction,
    parseBadgesTag,
    parseEmotesTag,
    parseIrcLine,
    unescapeTag,
} from "../../src/lib/chat/irc/parse";

describe("parseIrcLine", () => {
    it("parses a tagged PRIVMSG captured from Twitch", () => {
        const line =
            "@badge-info=;badges=premium/1;color=#1E90FF;display-name=viewer_one;emotes=425618:12-14;" +
            "id=00000000-0000-4000-8000-000000000001;room-id=552120296;tmi-sent-ts=1790708943647;" +
            "user-id=100000001;user-type= :viewer_one!viewer_one@viewer_one.tmi.twitch.tv PRIVMSG #zackrawrr :1 more hour LUL";
        const message = parseIrcLine(line);
        assert.ok(message);
        assert.equal(message.command, "PRIVMSG");
        assert.equal(message.nick, "viewer_one");
        assert.deepEqual(message.params, ["#zackrawrr", "1 more hour LUL"]);
        assert.equal(message.tags["display-name"], "viewer_one");
        assert.equal(message.tags["user-type"], "");
        assert.equal(message.tags["badge-info"], "");
    });

    it("unescapes tag values", () => {
        const message = parseIrcLine(
            "@system-msg=viewer_two\\ssubscribed\\swith\\sPrime.;msg-id=sub :tmi.twitch.tv USERNOTICE #jynxzi",
        );
        assert.equal(message?.tags["system-msg"], "viewer_two subscribed with Prime.");
        assert.equal(message?.nick, undefined);
        assert.deepEqual(message?.params, ["#jynxzi"]);
        assert.equal(unescapeTag("a\\:b\\\\c\\"), "a;b\\c");
    });

    it("parses untagged commands and trailing-only params", () => {
        assert.deepEqual(parseIrcLine("PING :tmi.twitch.tv"), {
            tags: {},
            nick: undefined,
            command: "PING",
            params: ["tmi.twitch.tv"],
        });
        assert.deepEqual(parseIrcLine(":tmi.twitch.tv CLEARCHAT #zackrawrr :some_user")?.params, [
            "#zackrawrr",
            "some_user",
        ]);
        assert.equal(parseIrcLine(""), undefined);
    });
});

describe("tag helpers", () => {
    it("parses and sorts emote ranges", () => {
        assert.deepEqual(parseEmotesTag("25:12-16/1902:0-4,6-10"), [
            { id: "1902", start: 0, end: 4 },
            { id: "1902", start: 6, end: 10 },
            { id: "25", start: 12, end: 16 },
        ]);
        assert.deepEqual(parseEmotesTag(""), []);
        assert.deepEqual(parseEmotesTag(undefined), []);
    });

    it("parses badges", () => {
        assert.deepEqual(parseBadgesTag("moderator/1,subscriber/3012"), [
            { set: "moderator", version: "1" },
            { set: "subscriber", version: "3012" },
        ]);
        assert.deepEqual(parseBadgesTag(""), []);
    });

    it("unwraps /me actions", () => {
        assert.deepEqual(parseAction("\u0001ACTION waves\u0001"), { text: "waves", action: true });
        assert.deepEqual(parseAction("hello"), { text: "hello", action: false });
    });
});
