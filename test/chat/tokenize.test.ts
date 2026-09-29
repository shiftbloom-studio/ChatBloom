import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FfzFlag, NO_EFFECTS } from "../../src/lib/chat/effects";
import { EmoteSet } from "../../src/lib/chat/emote-set";
import { parseEmotesTag } from "../../src/lib/chat/irc/parse";
import { type MessagePart, tokenize } from "../../src/lib/chat/tokenize";
import type { Emote } from "../../src/lib/chat/types";

const emote = (name: string, extra: Partial<Emote> = {}): Emote => ({
    provider: "7tv",
    id: `id-${name}`,
    name,
    images: { 1: `https://cdn.example/${name}/1x.webp` },
    ...extra,
});

const set = new EmoteSet([
    emote("Clap"),
    emote("RainTime", { zeroWidth: true }),
    emote("SteerR", { zeroWidth: true }),
    emote("w!", { provider: "bttv", bttvModifier: true }),
    emote("h!", { provider: "bttv", bttvModifier: true }),
    emote("ffzW", { provider: "ffz", ffzModifierFlags: FfzFlag.Hidden | FfzFlag.GrowX }),
    emote("ffzHyper", {
        provider: "ffz",
        ffzModifierFlags: FfzFlag.Hidden | FfzFlag.HyperRed | FfzFlag.Shake,
    }),
    emote("ffzHat", { provider: "ffz", ffzModifierFlags: 0 }),
]);
const lookup = (name: string) => set.get(name);

/** Compact rendering of parts for readable assertions. */
function show(parts: MessagePart[]): string {
    return parts
        .map((part) => {
            if (part.type === "text") return part.text;
            if (part.type === "mention") return `<${part.text}>`;
            const overlays = part.overlays.map((o) => `+${o.name}`).join("");
            return `[${part.emote.provider}:${part.emote.name}${overlays}]`;
        })
        .join("");
}

describe("tokenize", () => {
    it("cuts Twitch emotes by code point, not UTF-16 unit", () => {
        const text = "👋 hi Kappa there";
        const parts = tokenize(text, parseEmotesTag("25:5-9"), lookup);
        assert.equal(show(parts), "👋 hi [twitch:Kappa] there");
        const kappa = parts[1];
        assert.equal(
            kappa.type === "emote" && kappa.emote.images[1],
            "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
        );
    });

    it("ignores ranges that overlap or run past the message", () => {
        assert.equal(
            show(tokenize("Kappa", parseEmotesTag("25:0-4,2-6/1:0-40"), lookup)),
            "[twitch:Kappa]",
        );
    });

    it("matches third-party emotes per word and keeps punctuation as text", () => {
        assert.equal(show(tokenize("Clap Clap, clap", [], lookup)), "[7tv:Clap] Clap, clap");
    });

    it("stacks zero-width emotes onto the previous emote", () => {
        assert.equal(
            show(tokenize("Kappa RainTime SteerR hi", parseEmotesTag("25:0-4"), lookup)),
            "[twitch:Kappa+RainTime+SteerR] hi",
        );
    });

    it("renders a zero-width emote on its own when nothing precedes it", () => {
        assert.equal(show(tokenize("RainTime hi", [], lookup)), "[7tv:RainTime] hi");
        assert.equal(show(tokenize("hi RainTime", [], lookup)), "hi [7tv:RainTime]");
    });

    it("applies BTTV prefix modifiers to the next emote", () => {
        const parts = tokenize("look w! h! Clap", [], lookup);
        assert.equal(show(parts), "look [7tv:Clap]");
        const clap = parts[1];
        assert.ok(clap.type === "emote");
        assert.equal(clap.effects.aspectRatio, 4);
        assert.deepEqual(clap.effects.transforms, ["scaleX(-1)"]);
    });

    it("keeps BTTV prefix modifiers as text when no emote follows", () => {
        assert.equal(show(tokenize("w! hello h!", [], lookup)), "w! hello h!");
    });

    it("applies FFZ modifier flags to the previous emote", () => {
        const parts = tokenize("Clap ffzW ffzHyper done", [], lookup);
        assert.equal(show(parts), "[7tv:Clap] done");
        const clap = parts[0];
        assert.ok(clap.type === "emote");
        assert.equal(clap.effects.widthScale, 2);
        assert.equal(clap.effects.filters.length, 1);
        assert.deepEqual(clap.effects.animations, ["cb-fx-shake 0.1s linear infinite"]);
    });

    it("overlays FFZ modifiers that are not hidden", () => {
        assert.equal(show(tokenize("Clap ffzHat", [], lookup)), "[7tv:Clap+ffzHat]");
    });

    it("renders a modifier with nothing to modify as a plain emote", () => {
        const parts = tokenize("ffzW", [], lookup);
        assert.equal(show(parts), "[ffz:ffzW]");
        assert.equal(parts[0].type === "emote" && parts[0].effects, NO_EFFECTS);
    });

    it("does not carry modifiers across text", () => {
        assert.equal(show(tokenize("Clap and ffzW", [], lookup)), "[7tv:Clap] and [ffz:ffzW]");
    });

    it("marks mentions and collapses repeated spaces", () => {
        assert.equal(show(tokenize("@forsen   hi  @ x", [], lookup)), "<@forsen> hi @ x");
    });
});

describe("EmoteSet", () => {
    it("supports live add, rename and remove", () => {
        const live = new EmoteSet([emote("A")]);
        live.add(emote("B"));
        live.rename("id-A", "A2");
        assert.equal(live.get("A"), undefined);
        assert.equal(live.get("A2")?.id, "id-A");
        live.remove("id-B");
        assert.equal(live.get("B"), undefined);
        assert.equal(live.size, 1);
    });
});
