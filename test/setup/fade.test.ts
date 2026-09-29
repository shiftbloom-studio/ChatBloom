import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_FADE, readFadeSeconds, SUGGESTED_FADE } from "../../src/components/setup/fade";
import { DEFAULT_SETTINGS, parseSettings, settingsQuery } from "../../src/lib/overlay/settings";

const throughLink = (fade: number) =>
    parseSettings(new URLSearchParams(settingsQuery({ ...DEFAULT_SETTINGS, fade }))).fade;

describe("readFadeSeconds", () => {
    it("reads whole seconds", () => {
        assert.equal(readFadeSeconds("45"), 45);
        assert.equal(readFadeSeconds(" 120 "), 120);
    });

    it("rounds fractions, with a point or a comma", () => {
        assert.equal(readFadeSeconds("12.4"), 12);
        assert.equal(readFadeSeconds("12,6"), 13);
    });

    it("keeps the time between one second and the longest the overlay accepts", () => {
        assert.equal(readFadeSeconds("0"), 1);
        assert.equal(readFadeSeconds("-20"), 1);
        assert.equal(readFadeSeconds("601"), MAX_FADE);
        assert.equal(readFadeSeconds("99999"), MAX_FADE);
    });

    it("waits for a number", () => {
        for (const text of ["", "   ", "soon", "12s", "Infinity", "NaN"]) {
            assert.equal(readFadeSeconds(text), undefined, text);
        }
    });

    it("suggests a time the overlay accepts", () => {
        assert.equal(readFadeSeconds(String(SUGGESTED_FADE)), SUGGESTED_FADE);
        assert.equal(throughLink(SUGGESTED_FADE), SUGGESTED_FADE);
    });

    it("agrees with the overlay on the longest time", () => {
        assert.equal(throughLink(MAX_FADE), MAX_FADE);
        assert.equal(throughLink(MAX_FADE + 1), DEFAULT_SETTINGS.fade);
    });
});
