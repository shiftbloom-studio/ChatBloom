import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type IrcLineInfo, inspectIrcLine } from "../../../src/worker/relay/irc";
import { ReplayBuffer } from "../../../src/worker/relay/replay";
import { chatLine } from "./lines";

/** The message ids a buffer of the given size replays after the given lines, oldest first. */
function replayed(limit: number, lines: string[]): string[] {
    const buffer = new ReplayBuffer(limit);
    for (const line of lines) buffer.observe(line, inspectIrcLine(line) as IrcLineInfo);
    return buffer.lines().map((line) => /;id=([^;]+);/.exec(line)?.[1] ?? "");
}

describe("ReplayBuffer", () => {
    it("keeps the newest chat lines up to its limit", () => {
        const lines = [1, 2, 3, 4, 5].map((index) => chatLine("alpha", `m-${index}`));
        assert.deepEqual(replayed(3, lines), ["m-3", "m-4", "m-5"]);
        assert.deepEqual(replayed(0, lines), []);
    });

    // A message a moderator removed must never be shown on stream again.
    it("drops what a moderator removed", () => {
        const users = ["1001", "2002", "1001"];
        const lines = users.map((user, index) => chatLine("a", `m-${index}`, user));
        const cases: [string, string[]][] = [
            ["@target-msg-id=m-1 :tmi.twitch.tv CLEARMSG #a :text", ["m-0", "m-2"]],
            ["@target-user-id=1001 :tmi.twitch.tv CLEARCHAT #a :viewer1001", ["m-1"]],
            ["@room-id=1 :tmi.twitch.tv CLEARCHAT #a", []],
        ];
        for (const [clear, kept] of cases) assert.deepEqual(replayed(10, [...lines, clear]), kept);
    });
});
