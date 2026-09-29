import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sevenTVEmote } from "../../src/lib/chat/providers/seventv/api";
import { emoteSetChange } from "../../src/lib/chat/providers/seventv/events";
import {
    colorFromInt,
    paintFromV3,
    paintFromV4,
    type V4Paint,
} from "../../src/lib/chat/providers/seventv/paint";

// Trimmed from frames the 7TV EventAPI sent on 2026-09-29.
const PINK_PRINCESS = {
    id: "01H9902AVR000BVQ7MEDFXVNTG",
    name: "Pink Princess",
    color: null,
    function: "LINEAR_GRADIENT" as const,
    repeat: false,
    angle: 0,
    shape: "circle",
    image_url: "",
    stops: [
        { at: 0.2, color: -214919681 },
        { at: 0.7, color: -3673601 },
    ],
    shadows: [{ x_offset: 0, y_offset: 0, radius: 0.1, color: -6369025 }],
};

const host = {
    url: "//cdn.7tv.app/emote/01FGJ0HW0G00021TQRJX35N1ZK",
    files: [
        { name: "1x.webp", width: 32, height: 32, format: "WEBP" },
        { name: "2x.webp", width: 64, height: 64, format: "WEBP" },
        { name: "1x.avif", width: 32, height: 32, format: "AVIF" },
        { name: "4x.webp", width: 128, height: 128, format: "WEBP" },
    ],
};
const active = (id: string, name: string, flags = 0) => ({
    id,
    name,
    flags,
    data: { id, name, flags: 0, animated: false, host },
});

describe("7TV paints", () => {
    it("decodes signed RGBA integers", () => {
        assert.equal(colorFromInt(-1), "#ffffffff");
        assert.equal(colorFromInt(102), "#00000066");
        assert.equal(colorFromInt(-214919681), "#f33095ff");
    });

    it("converts a v3 gradient paint", () => {
        const paint = paintFromV3(PINK_PRINCESS);
        assert.deepEqual(paint.layers, [
            {
                opacity: 1,
                image: "linear-gradient(0deg, #f33095ff 20%, #ffc7f1ff 70%)",
                color: undefined,
            },
        ]);
        assert.equal(paint.filter, "drop-shadow(#ff9ed0ff 0px 0px 0.1px)");
    });

    it("converts repeating radial and image paints", () => {
        const radial = paintFromV3({
            ...PINK_PRINCESS,
            function: "RADIAL_GRADIENT",
            repeat: true,
            shadows: null,
        });
        assert.match(radial.layers[0].image ?? "", /^repeating-radial-gradient\(circle, /);
        assert.equal(radial.filter, undefined);

        const image = paintFromV3({
            ...PINK_PRINCESS,
            function: "URL",
            stops: [],
            image_url: "https://cdn.7tv.app/paint/x/layer/y/1x.webp",
        });
        assert.equal(image.layers[0].image, 'url("https://cdn.7tv.app/paint/x/layer/y/1x.webp")');
    });

    it("keeps shadow-only paints layerless", () => {
        assert.deepEqual(paintFromV3({ ...PINK_PRINCESS, stops: [] }).layers, []);
    });

    it("renders every v4 layer with its opacity and prefers animated images", () => {
        const v4: V4Paint = {
            id: "p",
            name: "Layered",
            data: {
                layers: [
                    {
                        opacity: 1,
                        ty: {
                            __typename: "PaintLayerTypeLinearGradient",
                            angle: 66,
                            repeating: true,
                            stops: [
                                { at: 0.5, color: { hex: "#CA804EFF" } },
                                { at: 1, color: { hex: "#503611FF" } },
                            ],
                        },
                    },
                    {
                        opacity: 0.5,
                        ty: {
                            __typename: "PaintLayerTypeImage",
                            images: [
                                { url: "https://cdn/1x_static.webp", scale: 1, frameCount: 1 },
                                { url: "https://cdn/1x.webp", scale: 1, frameCount: 24 },
                                { url: "https://cdn/2x.webp", scale: 2, frameCount: 24 },
                            ],
                        },
                    },
                    {
                        opacity: 1,
                        ty: {
                            __typename: "PaintLayerTypeSingleColor",
                            color: { hex: "#FF0000FF" },
                        },
                    },
                ],
                shadows: [{ color: { hex: "#000000FF" }, offsetX: 1, offsetY: 2, blur: 3 }],
            },
        };
        const paint = paintFromV4(v4);
        assert.deepEqual(paint.layers, [
            {
                opacity: 1,
                image: "repeating-linear-gradient(66deg, #CA804EFF 50%, #503611FF 100%)",
            },
            { opacity: 0.5, image: 'url("https://cdn/1x.webp")' },
            { opacity: 1, color: "#FF0000FF" },
        ]);
        assert.equal(paint.filter, "drop-shadow(#000000FF 1px 2px 3px)");
    });
});

describe("7TV emotes", () => {
    it("builds WebP image sets and reads the zero-width flag", () => {
        const emote = sevenTVEmote(active("e1", "RainTime", 1));
        assert.deepEqual(emote?.images, {
            1: "https://cdn.7tv.app/emote/01FGJ0HW0G00021TQRJX35N1ZK/1x.webp",
            2: "https://cdn.7tv.app/emote/01FGJ0HW0G00021TQRJX35N1ZK/2x.webp",
            4: "https://cdn.7tv.app/emote/01FGJ0HW0G00021TQRJX35N1ZK/4x.webp",
        });
        assert.equal(emote?.zeroWidth, true);
        assert.equal(emote?.width, 32);
        assert.equal(sevenTVEmote({ id: "gone", name: "gone", flags: 0, data: null }), undefined);
    });

    it("reads EventAPI emote set changes, treating renames as remove + add", () => {
        const change = emoteSetChange({
            id: "set",
            pushed: [{ key: "emotes", index: 0, value: active("new", "Laughge") }],
            pulled: [{ key: "emotes", index: 1, old_value: active("old", "Old") }],
            updated: [
                {
                    key: "emotes",
                    index: 2,
                    old_value: active("ren", "Before"),
                    value: active("ren", "After"),
                },
                { key: "name", value: "ignored" },
            ],
        });
        assert.deepEqual(change.removed, ["old", "ren"]);
        assert.deepEqual(
            change.added.map((e) => e.name),
            ["After", "Laughge"],
        );
    });
});
