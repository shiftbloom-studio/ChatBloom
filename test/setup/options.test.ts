import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    countChanged,
    EMOTE_SIZES,
    MORE_OPTIONS,
    SHADOWS,
    SIZES,
    STROKES,
} from "../../src/components/setup/options";
import {
    DEFAULT_SETTINGS,
    type OverlaySettings,
    parseSettings,
    settingsQuery,
} from "../../src/lib/overlay/settings";

describe("choices", () => {
    // A choice the overlay does not understand would silently fall back to the default.
    it("offers only values the overlay accepts", () => {
        const choices = { size: SIZES, stroke: STROKES, shadow: SHADOWS, emotes: EMOTE_SIZES };
        for (const [key, options] of Object.entries(choices)) {
            for (const option of options) {
                const settings = { ...DEFAULT_SETTINGS, [key]: option.value } as OverlaySettings;
                const query = new URLSearchParams(settingsQuery(settings));
                assert.deepEqual(parseSettings(query), settings, `${key}=${option.value}`);
            }
        }
    });

    it("offers the default of every choice", () => {
        assert.ok(SIZES.some((option) => option.value === DEFAULT_SETTINGS.size));
        assert.ok(STROKES.some((option) => option.value === DEFAULT_SETTINGS.stroke));
        assert.ok(SHADOWS.some((option) => option.value === DEFAULT_SETTINGS.shadow));
        assert.ok(EMOTE_SIZES.some((option) => option.value === DEFAULT_SETTINGS.emotes));
    });
});

describe("countChanged", () => {
    it("finds nothing changed in the defaults", () => {
        assert.equal(countChanged(DEFAULT_SETTINGS, MORE_OPTIONS), 0);
        assert.equal(countChanged({ ...DEFAULT_SETTINGS, ignore: [] }, MORE_OPTIONS), 0);
    });

    it("counts every setting that differs", () => {
        const settings: OverlaySettings = {
            ...DEFAULT_SETTINGS,
            fade: DEFAULT_SETTINGS.fade + 30,
            badges: !DEFAULT_SETTINGS.badges,
            ignore: ["nightbot", "moobot"],
        };
        assert.equal(countChanged(settings, MORE_OPTIONS), 3);
    });

    it("looks only at the settings it is asked about", () => {
        const settings: OverlaySettings = { ...DEFAULT_SETTINGS, size: 3, stroke: 2 };
        assert.equal(countChanged(settings, MORE_OPTIONS), 0);
        assert.equal(countChanged(settings, ["size", "stroke", "shadow"]), 2);
    });
});
