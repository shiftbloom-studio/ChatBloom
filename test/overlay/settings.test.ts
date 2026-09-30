import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEFAULT_SETTINGS,
    type OverlaySettings,
    parseSettings,
} from "../../src/lib/overlay/settings";

describe("parseSettings", () => {
    // A link lives on in OBS for good: whatever it does not set, or sets to a value the overlay
    // does not know, keeps the default instead of breaking the overlay.
    it("reads a link, and keeps the default for anything it does not know", () => {
        const customFont = (custom: string) => `custom=${encodeURIComponent(custom)}`;
        const cases: [string, Partial<OverlaySettings>][] = [
            ["", {}],
            ["direct=1&demo=1&foo=bar&SIZE=3&newline=1&show_homies=true", {}],
            [
                "size=3&font=Mono&stroke=2&shadow=0&emotes=2&fade=030",
                { size: 3, font: "mono", stroke: 2, shadow: 0, emotes: 2, fade: 30 },
            ],
            [
                "animate=0&badges=FALSE&bots=0&commands=0&caps=1&nl=1&names=0&homies=true",
                {
                    animate: false,
                    badges: false,
                    bots: false,
                    commands: false,
                    caps: true,
                    newline: true,
                    names: false,
                    homies: true,
                },
            ],
            ["size=3&size=2", { size: 3 }],
            ["ignore=b_bot&ignore=@A_Bot,,bad-name", { ignore: ["a_bot", "b_bot"] }],
            ["custom=Comic+Sans+MS", { custom: "Comic Sans MS" }],
            ["size=4&emotes=1.5&stroke=-1&shadow=9&font=comic&fade=601", {}],
            ["animate=yes&badges=2&caps=on&fade=1e2&size=%&emotes=%00", {}],
            // A custom font is a name only: anything more could restyle the overlay or load
            // something from elsewhere into the streamer's OBS.
            [customFont('x", serif; background: url(https://elsewhere.example/)'), {}],
            [customFont("x}body{display:none"), {}],
            [customFont("a".repeat(41)), {}],
        ];
        for (const [query, change] of cases) {
            const settings = parseSettings(new URLSearchParams(query));
            assert.deepEqual(settings, { ...DEFAULT_SETTINGS, ...change }, query);
        }
    });
});
