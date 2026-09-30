import assert from "node:assert/strict";
import { it } from "node:test";

import { FfzFlag } from "../../src/lib/chat/effects";
import { EmoteSet } from "../../src/lib/chat/emote-set";
import { parseEmotesTag, parseIrcLine } from "../../src/lib/chat/irc/parse";
import { type MessagePart, tokenize } from "../../src/lib/chat/tokenize";
import type { Emote } from "../../src/lib/chat/types";

it("parses tagged, escaped and untagged IRC lines", () => {
    const message = parseIrcLine(
        "@badge-info=;display-name=viewer_one;emotes=425618:12-14;user-type= " +
            ":viewer_one!viewer_one@viewer_one.tmi.twitch.tv PRIVMSG #zackrawrr :1 more hour LUL",
    );
    assert.equal(message?.command, "PRIVMSG");
    assert.equal(message?.nick, "viewer_one");
    assert.deepEqual(message?.params, ["#zackrawrr", "1 more hour LUL"]);
    assert.equal(message?.tags["display-name"], "viewer_one");
    assert.equal(message?.tags["user-type"], "");

    const notice = parseIrcLine("@system-msg=a\\sb\\:c\\\\d\\ :tmi.twitch.tv USERNOTICE #jynxzi");
    assert.equal(notice?.tags["system-msg"], "a b;c\\d");
    assert.equal(notice?.nick, undefined);
    assert.deepEqual(notice?.params, ["#jynxzi"]);
});

const emote = (name: string, extra: Partial<Emote> = {}): Emote => ({
    provider: "7tv",
    id: `id-${name}`,
    name,
    images: { 1: `https://cdn.example/${name}/1x.webp` },
    ...extra,
});

const { Hidden, GrowX, HyperRed, Shake } = FfzFlag;
const set = new EmoteSet([
    emote("Clap"),
    emote("RainTime", { zeroWidth: true }),
    emote("SteerR", { zeroWidth: true }),
    emote("w!", { provider: "bttv", bttvModifier: true }),
    emote("h!", { provider: "bttv", bttvModifier: true }),
    emote("ffzW", { provider: "ffz", ffzModifierFlags: Hidden | GrowX }),
    emote("ffzHyper", { provider: "ffz", ffzModifierFlags: Hidden | HyperRed | Shake }),
    emote("ffzHat", { provider: "ffz", ffzModifierFlags: 0 }),
]);
const parts = (text: string, emotes = "") =>
    tokenize(text, parseEmotesTag(emotes), (name) => set.get(name));

/** Compact rendering of parts for readable assertions. */
const show = (list: MessagePart[]) =>
    list
        .map((part) => {
            if (part.type === "text") return part.text;
            if (part.type === "mention") return `<${part.text}>`;
            const overlays = part.overlays.map((o) => `+${o.name}`).join("");
            return `[${part.emote.provider}:${part.emote.name}${overlays}]`;
        })
        .join("");

it("cuts messages into text, mentions and emotes", () => {
    for (const [text, emotes, expected] of [
        // Twitch counts code points, not UTF-16 units, and bad ranges are ignored.
        ["👋 hi Kappa there", "25:5-9", "👋 hi [twitch:Kappa] there"],
        ["Kappa", "25:0-4,2-6/1:0-40", "[twitch:Kappa]"],
        ["Kappa Keepo", "1902:6-10/25:0-4", "[twitch:Kappa] [twitch:Keepo]"],
        ["Clap Clap, clap", "", "[7tv:Clap] Clap, clap"],
        ["Kappa RainTime SteerR hi", "25:0-4", "[twitch:Kappa+RainTime+SteerR] hi"],
        ["RainTime hi RainTime", "", "[7tv:RainTime] hi [7tv:RainTime]"],
        ["look w! h! Clap", "", "look [7tv:Clap]"],
        ["w! hello h!", "", "w! hello h!"],
        ["Clap ffzW ffzHyper done", "", "[7tv:Clap] done"],
        ["Clap ffzHat", "", "[7tv:Clap+ffzHat]"],
        ["Clap and ffzW", "", "[7tv:Clap] and [ffz:ffzW]"],
        ["@forsen   hi  @ x", "", "<@forsen> hi @ x"],
    ]) {
        assert.equal(show(parts(text, emotes)), expected, text);
    }
});

it("applies BTTV modifiers to the next emote and FFZ modifiers to the previous one", () => {
    const [, bttv] = parts("look w! h! Clap");
    const [ffz] = parts("Clap ffzW ffzHyper");
    assert.ok(bttv.type === "emote" && ffz.type === "emote");
    assert.equal(bttv.effects.aspectRatio, 4);
    assert.deepEqual(bttv.effects.transforms, ["scaleX(-1)"]);
    assert.equal(ffz.effects.widthScale, 2);
    assert.deepEqual(ffz.effects.animations, ["cb-fx-shake 0.1s linear infinite"]);
});
