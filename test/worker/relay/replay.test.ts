import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inspectIrcLine } from "../../../src/worker/relay/irc";
import { mergeRoomstate, ReplayBuffer } from "../../../src/worker/relay/replay";
import { chatLine, clearMessage, clearRoom, clearUser, notice, roomstate } from "./lines";

const REPLAY_TAG = "petal-replay=1";

function observe(buffer: ReplayBuffer, ...lines: string[]): void {
    for (const line of lines) {
        const info = inspectIrcLine(line);
        assert.ok(info, line);
        buffer.observe(line, info);
    }
}

/** The message ids in the buffer, oldest first. */
function ids(buffer: ReplayBuffer): string[] {
    return buffer.lines().map((line) => /;id=([^;]+);/.exec(line)?.[1] ?? "");
}

describe("ReplayBuffer", () => {
    it("keeps the newest lines up to its limit", () => {
        const buffer = new ReplayBuffer(3);
        for (let index = 1; index <= 5; index++) {
            observe(buffer, chatLine("alpha", { id: `m-${index}` }));
        }
        assert.equal(buffer.size, 3);
        assert.deepEqual(ids(buffer), ["m-3", "m-4", "m-5"]);
    });

    it("keeps chat messages and user notices, and nothing else", () => {
        const buffer = new ReplayBuffer(10);
        observe(
            buffer,
            roomstate("alpha"),
            chatLine("alpha", { id: "m-1" }),
            notice("alpha", "slow_on"),
            chatLine("alpha", { id: "m-2", command: "USERNOTICE" }),
        );
        assert.deepEqual(ids(buffer), ["m-1", "m-2"]);
    });

    it("marks what it replays and leaves the line itself alone", () => {
        const buffer = new ReplayBuffer(10);
        const tagged = chatLine("alpha", { id: "m-1" });
        const bare = ":viewer1!viewer1@viewer1.tmi.twitch.tv PRIVMSG #alpha :synthetic";
        observe(buffer, tagged, bare);
        assert.deepEqual(buffer.lines(), [
            `@${REPLAY_TAG};${tagged.slice(1)}`,
            `@${REPLAY_TAG} ${bare}`,
        ]);
    });

    it("drops the lines of a user who was timed out or banned", () => {
        const buffer = new ReplayBuffer(10);
        observe(
            buffer,
            chatLine("alpha", { id: "m-1", userId: "1001" }),
            chatLine("alpha", { id: "m-2", userId: "2002" }),
            chatLine("alpha", { id: "m-3", userId: "1001" }),
            clearUser("alpha", "1001"),
        );
        assert.deepEqual(ids(buffer), ["m-2"]);
    });

    it("drops everything when the room is cleared", () => {
        const buffer = new ReplayBuffer(10);
        observe(
            buffer,
            chatLine("alpha", { id: "m-1", userId: "1001" }),
            chatLine("alpha", { id: "m-2", userId: "2002" }),
            clearRoom("alpha"),
        );
        assert.equal(buffer.size, 0);
        assert.deepEqual(buffer.lines(), []);

        observe(buffer, chatLine("alpha", { id: "m-3" }));
        assert.deepEqual(ids(buffer), ["m-3"]);
    });

    it("drops a single deleted message", () => {
        const buffer = new ReplayBuffer(10);
        observe(
            buffer,
            chatLine("alpha", { id: "m-1" }),
            chatLine("alpha", { id: "m-2" }),
            chatLine("alpha", { id: "m-3" }),
            clearMessage("alpha", "m-2"),
        );
        assert.deepEqual(ids(buffer), ["m-1", "m-3"]);
    });

    it("keeps lines without an id when a deletion names none", () => {
        const buffer = new ReplayBuffer(10);
        observe(
            buffer,
            ":viewer1!viewer1@viewer1.tmi.twitch.tv PRIVMSG #alpha :synthetic",
            "@room-id=1 :tmi.twitch.tv CLEARMSG #alpha :synthetic",
        );
        assert.equal(buffer.size, 1);
    });

    it("keeps nothing with a limit of zero", () => {
        const buffer = new ReplayBuffer(0);
        observe(buffer, chatLine("alpha", { id: "m-1" }));
        assert.equal(buffer.size, 0);
        assert.deepEqual(buffer.lines(), []);
    });
});

describe("mergeRoomstate", () => {
    it("takes the first room state as it is", () => {
        assert.equal(mergeRoomstate(undefined, roomstate("alpha")), roomstate("alpha"));
    });

    it("applies a change to the cached state", () => {
        const merged = mergeRoomstate(
            roomstate("alpha"),
            "@room-id=1;slow=30 :tmi.twitch.tv ROOMSTATE #alpha",
        );
        assert.equal(
            merged,
            "@emote-only=0;followers-only=-1;r9k=0;room-id=1;slow=30;subs-only=0 " +
                ":tmi.twitch.tv ROOMSTATE #alpha",
        );
    });

    it("replaces a state it cannot merge", () => {
        const update = ":tmi.twitch.tv ROOMSTATE #alpha";
        assert.equal(mergeRoomstate(roomstate("alpha"), update), update);
        assert.equal(mergeRoomstate(update, roomstate("alpha")), roomstate("alpha"));
    });
});
