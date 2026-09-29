import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emoteScale, fontFamily, textScale } from "../../src/lib/overlay/look";
import { DEFAULT_SETTINGS, FONTS, type OverlaySettings } from "../../src/lib/overlay/settings";

const changed = (change: Partial<OverlaySettings>): OverlaySettings => ({
    ...DEFAULT_SETTINGS,
    ...change,
});

describe("the look of the overlay", () => {
    it("leaves the default look untouched", () => {
        assert.equal(textScale(DEFAULT_SETTINGS), 1);
        assert.equal(emoteScale(DEFAULT_SETTINGS), 1);
        assert.equal(fontFamily(DEFAULT_SETTINGS), undefined);
    });

    it("grows with the size", () => {
        const scales = ([1, 2, 3] as const).map((size) => textScale(changed({ size })));
        assert.deepEqual(scales, [1, 1.5, 2]);
    });

    it("scales emotes with the text", () => {
        for (const size of [1, 2, 3] as const) {
            const settings = changed({ size });
            assert.equal(emoteScale(settings), textScale(settings));
        }
    });

    it("scales emotes on top of the text, and leaves the text alone", () => {
        assert.equal(emoteScale(changed({ emotes: 2 })), 1.5);
        assert.equal(emoteScale(changed({ emotes: 3 })), 2);
        assert.equal(emoteScale(changed({ size: 2, emotes: 2 })), 2.25);
        assert.equal(emoteScale(changed({ size: 3, emotes: 3 })), 4);
        assert.equal(textScale(changed({ emotes: 3 })), 1);
    });

    it("puts a custom font before the stack of the chosen font", () => {
        assert.equal(
            fontFamily(changed({ custom: "Comic Sans MS" })),
            '"Comic Sans MS", "Roboto", system-ui, sans-serif',
        );
        for (const font of FONTS) {
            assert.equal(
                fontFamily(changed({ font: font.id, custom: "Impact" })),
                `"Impact", ${font.family}`,
            );
        }
    });

    it("quotes a custom font that is named like a keyword of CSS", () => {
        for (const custom of ["inherit", "serif", "initial", "system-ui"]) {
            assert.equal(
                fontFamily(changed({ custom })),
                `"${custom}", "Roboto", system-ui, sans-serif`,
            );
        }
    });

    it("never lets a custom font be more than one quoted name", () => {
        for (const custom of [
            'x", serif; color: red',
            "x'; color: red",
            "x\\",
            "x; background: url(https://elsewhere.example/)",
            "x}body{display:none",
            "a".repeat(41),
        ]) {
            assert.equal(fontFamily(changed({ custom })), undefined, custom);
            assert.equal(
                fontFamily(changed({ font: "mono", custom })),
                FONTS.find((font) => font.id === "mono")?.family,
                custom,
            );
        }
        for (const custom of ["Impact", "Comic Sans MS", "Söhne", "a-b_c.d"]) {
            assert.match(fontFamily(changed({ custom })) ?? "", /^"[^"\\;{}()]+", "Roboto", /);
        }
    });

    it("sets the stack of every font but the default one", () => {
        for (const font of FONTS) {
            const family = fontFamily(changed({ font: font.id }));
            assert.equal(family, font.id === DEFAULT_SETTINGS.font ? undefined : font.family);
        }
    });
});
