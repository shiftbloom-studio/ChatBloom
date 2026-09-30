import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overlayUrl, PRODUCTION_ORIGIN, previewPath } from "../../src/components/setup/link";
import {
    DEFAULT_SETTINGS,
    type OverlaySettings,
    parseSettings,
} from "../../src/lib/overlay/settings";

describe("overlayUrl", () => {
    it("is the plain address of the channel for the default look", () => {
        assert.equal(
            overlayUrl(PRODUCTION_ORIGIN, "papaplatte", DEFAULT_SETTINGS),
            "https://petal.shiftbloom.studio/chat/papaplatte",
        );
    });

    it("carries each setting that differs, and the overlay reads it back as chosen", () => {
        const changes: Partial<OverlaySettings>[] = [
            { size: 2 },
            { font: "alsina" },
            { stroke: 1 },
            { shadow: 0 },
            { emotes: 2 },
            { animate: false },
            { fade: 45 },
            { badges: false },
            { bots: false },
            { commands: false },
            { caps: true },
            { ignore: ["some_bot"] },
            { custom: "Söhne Mono" },
            { newline: true },
            { names: false },
            { homies: true },
        ];
        // Each change on its own, then all of them in one link.
        const rows = changes.map((change): [Partial<OverlaySettings>, number] => [change, 1]);
        rows.push([Object.assign({}, ...changes), changes.length]);
        for (const [change, keys] of rows) {
            const settings = { ...DEFAULT_SETTINGS, ...change };
            const url = new URL(overlayUrl(PRODUCTION_ORIGIN, "papaplatte", settings));
            assert.equal(`${url.origin}${url.pathname}`, `${PRODUCTION_ORIGIN}/chat/papaplatte`);
            assert.equal([...url.searchParams.keys()].length, keys, url.search);
            assert.deepEqual(parseSettings(url.searchParams), settings, url.search);
        }
    });

    // The preview must show sample messages, never connect to a channel named "preview".
    it("previews the look on the page's own origin, in demo mode", () => {
        const url = new URL(previewPath({ ...DEFAULT_SETTINGS, size: 3 }), PRODUCTION_ORIGIN);
        assert.equal(url.origin, PRODUCTION_ORIGIN);
        assert.equal(url.searchParams.get("demo"), "1");
        assert.equal(parseSettings(url.searchParams).size, 3);
    });
});
