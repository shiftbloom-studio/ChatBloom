import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeIgnoreList, MAX_IGNORED } from "../../src/components/setup/ignore";
import { parseIgnoreList } from "../../src/lib/overlay/settings";

const describeInput = (input: string) => describeIgnoreList(input, parseIgnoreList(input));

const bots = (count: number) => Array.from({ length: count }, (_, index) => `bot_${index + 10}`);

describe("describeIgnoreList", () => {
    it("says nothing while the field is empty", () => {
        assert.equal(describeInput(""), "");
        assert.equal(describeInput(" , \n"), "");
    });

    it("counts the names the link carries", () => {
        assert.equal(describeInput("Nightbot"), "1 name accepted.");
        assert.equal(describeInput("nightbot, @StreamElements  moobot"), "3 names accepted.");
        assert.equal(describeInput("nightbot;moobot\nfossabot"), "3 names accepted.");
    });

    it("counts a name once, however often and however it is written", () => {
        assert.equal(describeInput("nightbot Nightbot @nightbot"), "1 name accepted.");
    });

    it("names the entries that are not Twitch names", () => {
        assert.equal(
            describeInput("nightbot, night-bot, käse, night-bot"),
            "1 name accepted. Skipped: night-bot, käse.",
        );
        assert.equal(describeInput("!!"), "0 names accepted. Skipped: !!.");
    });

    it("says so when the list is full", () => {
        const names = bots(MAX_IGNORED + 1);
        const accepted = names.slice(0, MAX_IGNORED);
        assert.equal(
            describeIgnoreList(names.join(" "), accepted),
            "20 names accepted. Skipped: bot_30. A link carries 20 names at most.",
        );
        assert.equal(
            describeIgnoreList(accepted.join(","), accepted),
            "20 names accepted. A link carries 20 names at most.",
        );
    });

    it("agrees with the overlay on how many names fit", () => {
        assert.equal(parseIgnoreList(bots(MAX_IGNORED + 5).join(" ")).length, MAX_IGNORED);
    });
});
