import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { copyText } from "../../src/components/setup/clipboard";

const link = "https://petal.shiftbloom.studio/chat/papaplatte";

describe("copyText", () => {
    it("writes the text to the clipboard", async () => {
        const written: string[] = [];
        const clipboard = { writeText: async (text: string) => void written.push(text) };
        assert.equal(await copyText(link, clipboard), true);
        assert.deepEqual(written, [link]);
    });

    it("reports a clipboard that refuses", async () => {
        const clipboard = { writeText: () => Promise.reject(new DOMException("denied")) };
        assert.equal(await copyText(link, clipboard), false);
    });

    it("reports a browser without a clipboard", async () => {
        assert.equal(await copyText(link, undefined), false);
    });
});
