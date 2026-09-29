import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    overlayUrl,
    PREVIEW_CHANNEL,
    PRODUCTION_ORIGIN,
    previewPath,
} from "../../src/components/setup/link";
import { DEFAULT_SETTINGS, overlayPath } from "../../src/lib/overlay/settings";

// Different from the defaults, whatever the defaults are.
const size = DEFAULT_SETTINGS.size === 3 ? 1 : 3;
const fade = DEFAULT_SETTINGS.fade + 45;
const changed = { ...DEFAULT_SETTINGS, size, fade } as const;

describe("overlayUrl", () => {
    it("puts the origin of the page in front of the overlay path", () => {
        assert.equal(
            overlayUrl(PRODUCTION_ORIGIN, "papaplatte", DEFAULT_SETTINGS),
            "https://petal.shiftbloom.studio/chat/papaplatte",
        );
        assert.equal(
            overlayUrl("https://chat.shiftbloom.studio", "papaplatte", changed),
            `https://chat.shiftbloom.studio${overlayPath("papaplatte", changed)}`,
        );
    });

    it("carries only the settings that differ from the defaults", () => {
        const url = new URL(overlayUrl(PRODUCTION_ORIGIN, "papaplatte", changed));
        assert.deepEqual([...url.searchParams.keys()], ["size", "fade"]);
        assert.equal(url.searchParams.get("size"), String(size));
        assert.equal(url.searchParams.get("fade"), String(fade));
    });
});

describe("previewPath", () => {
    it("asks for demo mode, with or without other parameters", () => {
        assert.equal(previewPath(DEFAULT_SETTINGS), "/chat/preview?demo=1");
        assert.equal(previewPath(changed), `${overlayPath(PREVIEW_CHANNEL, changed)}&demo=1`);
    });

    it("stays on the page's own origin", () => {
        const url = new URL(previewPath(changed), PRODUCTION_ORIGIN);
        assert.equal(url.origin, PRODUCTION_ORIGIN);
        assert.equal(url.searchParams.get("demo"), "1");
    });
});
