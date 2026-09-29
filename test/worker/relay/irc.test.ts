import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inspectIrcLine, tagValue, withTag } from "../../../src/worker/relay/irc";
import { chatLine, clearMessage, clearRoom, joinEcho, notice, roomstate } from "./lines";

describe("inspectIrcLine", () => {
    it("finds command and channel behind tags and prefix", () => {
        const line = chatLine("alpha", { id: "m-1" });
        const info = inspectIrcLine(line);
        assert.equal(info?.command, "PRIVMSG");
        assert.equal(info?.channel, "alpha");
        assert.equal(line.slice(info?.bodyStart, (info?.bodyStart ?? 0) + 12), ":viewer1001!");
    });

    it("reads the lines the relay acts on", () => {
        const cases: [string, string, string | undefined][] = [
            [joinEcho("justinfan12345", "alpha"), "JOIN", "alpha"],
            [roomstate("alpha"), "ROOMSTATE", "alpha"],
            [clearRoom("alpha"), "CLEARCHAT", "alpha"],
            [clearMessage("alpha", "m-1"), "CLEARMSG", "alpha"],
            [notice("alpha"), "NOTICE", "alpha"],
            [chatLine("alpha", { id: "m-2", command: "USERNOTICE" }), "USERNOTICE", "alpha"],
            ["PING :tmi.twitch.tv", "PING", undefined],
            [":tmi.twitch.tv RECONNECT", "RECONNECT", undefined],
            [":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!", "001", undefined],
            [":tmi.twitch.tv NOTICE * :Improperly formatted auth", "NOTICE", undefined],
            [":justinfan1.tmi.twitch.tv 353 justinfan1 = #alpha :justinfan1", "353", undefined],
            ["@emote-sets=0 :tmi.twitch.tv GLOBALUSERSTATE", "GLOBALUSERSTATE", undefined],
        ];
        for (const [line, command, channel] of cases) {
            const info = inspectIrcLine(line);
            assert.equal(info?.command, command, line);
            assert.equal(info?.channel, channel, line);
        }
    });

    it("reports where the tags end", () => {
        assert.equal(inspectIrcLine("PING :tmi.twitch.tv")?.bodyStart, 0);
        assert.equal(inspectIrcLine("@a=1 :tmi.twitch.tv ROOMSTATE #alpha")?.bodyStart, 5);
    });

    it("refuses what is not a line", () => {
        for (const line of ["", "@only=tags", "@tags=1 :prefix", ":prefix", "@tags=1 "]) {
            assert.equal(inspectIrcLine(line), undefined, JSON.stringify(line));
        }
    });

    it("does not take a channel out of the text of a message", () => {
        const line = ":tmi.twitch.tv NOTICE * :see #alpha";
        assert.equal(inspectIrcLine(line)?.channel, undefined);
    });
});

describe("tagValue", () => {
    const line = chatLine("alpha", { id: "m-7", userId: "2002" });
    const info = inspectIrcLine(line);
    assert.ok(info);

    it("reads a tag wherever it stands", () => {
        assert.equal(tagValue(line, info, "badge-info"), "");
        assert.equal(tagValue(line, info, "id"), "m-7");
        assert.equal(tagValue(line, info, "user-id"), "2002");
        assert.equal(tagValue(line, info, "user-type"), "");
    });

    it("does not mistake a tag that ends the same way", () => {
        const reply = `@reply-parent-msg-id=parent;room-id=1;user-id=5 :a!a@a PRIVMSG #alpha :text`;
        const replyInfo = inspectIrcLine(reply);
        assert.ok(replyInfo);
        assert.equal(tagValue(reply, replyInfo, "id"), undefined);
        assert.equal(tagValue(reply, replyInfo, "msg-id"), undefined);
        assert.equal(tagValue(reply, replyInfo, "user-id"), "5");
    });

    it("finds nothing in the text of a message or without tags", () => {
        const text = "@room-id=1 :a!a@a PRIVMSG #alpha :id=forged;user-id=9";
        const textInfo = inspectIrcLine(text);
        assert.ok(textInfo);
        assert.equal(tagValue(text, textInfo, "id"), undefined);
        assert.equal(tagValue(text, textInfo, "user-id"), undefined);

        const bare = ":a!a@a PRIVMSG #alpha :id=forged";
        const bareInfo = inspectIrcLine(bare);
        assert.ok(bareInfo);
        assert.equal(tagValue(bare, bareInfo, "id"), undefined);
    });
});

describe("withTag", () => {
    it("puts the tag in front of the others", () => {
        assert.equal(
            withTag("@id=m-1;room-id=1 :a!a@a PRIVMSG #alpha :text", "petal-replay=1"),
            "@petal-replay=1;id=m-1;room-id=1 :a!a@a PRIVMSG #alpha :text",
        );
    });

    it("starts a tag section where there is none", () => {
        assert.equal(
            withTag(":a!a@a PRIVMSG #alpha :text", "petal-replay=1"),
            "@petal-replay=1 :a!a@a PRIVMSG #alpha :text",
        );
    });
});
