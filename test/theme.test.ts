import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overlayPath, parsePreference, resolveTheme } from "../src/lib/theme/mode";

describe("theme", () => {
    it("lets a stored choice win over the device, and ignores values it does not know", () => {
        const cases: [unknown, boolean, string][] = [
            [null, true, "dark"],
            [null, false, "light"],
            ["sepia", true, "dark"],
            ["DARK", false, "light"],
            ["light", true, "light"],
            ["dark", false, "dark"],
        ];
        for (const [stored, deviceDark, theme] of cases) {
            assert.equal(resolveTheme(parsePreference(stored), deviceDark), theme, `${stored}`);
        }
    });

    // A themed overlay would paint a background over the streamer's OBS scene.
    it("leaves the OBS overlay, and only the overlay, unthemed", () => {
        for (const path of ["/chat/zackrawrr", "/CHAT/zackrawrr", "/chat"]) {
            assert.equal(overlayPath.test(path), true, path);
        }
        for (const path of ["/", "/setup", "/chatty", "/x/chat/y"]) {
            assert.equal(overlayPath.test(path), false, path);
        }
    });
});
