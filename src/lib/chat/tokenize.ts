import {
    applyBttvModifier,
    applyFfzFlags,
    type EmoteEffects,
    FfzFlag,
    NO_EFFECTS,
} from "./effects";
import type { EmoteRange } from "./irc/parse";
import { twitchEmote } from "./providers/twitch";
import type { Emote } from "./types";

export interface EmotePart {
    type: "emote";
    emote: Emote;
    /** Zero-width emotes and visible FFZ modifiers, stacked on top of `emote`. */
    overlays: Emote[];
    effects: EmoteEffects;
}

export type MessagePart =
    | { type: "text"; text: string }
    | { type: "mention"; text: string }
    | EmotePart;

export type EmoteLookup = (name: string) => Emote | undefined;

interface Atom {
    word: string;
    /** Set for Twitch emotes, which come pre-located in the IRC tags. */
    emote?: Emote;
    spaceBefore: boolean;
}

/** Splits a message into space-separated words, cutting Twitch emotes out at their ranges. */
function atomize(text: string, ranges: EmoteRange[]): Atom[] {
    // Twitch counts code points, not UTF-16 units, so emoji before an emote shift nothing.
    const chars = Array.from(text);
    const atoms: Atom[] = [];
    let space = false;
    const pushWords = (segment: string) => {
        segment.split(" ").forEach((word, i) => {
            if (i > 0) space = true;
            if (word) {
                atoms.push({ word, spaceBefore: space });
                space = false;
            }
        });
    };

    let cursor = 0;
    for (const range of ranges) {
        if (range.start < cursor || range.end < range.start || range.end >= chars.length) continue;
        pushWords(chars.slice(cursor, range.start).join(""));
        const name = chars.slice(range.start, range.end + 1).join("");
        atoms.push({ word: name, emote: twitchEmote(range.id, name), spaceBefore: space });
        space = false;
        cursor = range.end + 1;
    }
    pushWords(chars.slice(cursor).join(""));
    return atoms;
}

/**
 * Turns a chat message into text, mention and emote parts. Third-party emotes are matched per
 * word through `lookup`, which decides provider priority. On top of that:
 * - zero-width emotes (7TV, BTTV) stack onto the preceding emote;
 * - FFZ modifier emotes (`ffzX`, `ffzHyper`, ...) apply their flags to the preceding emote;
 * - BTTV prefix modifiers (`w! h! Kappa`) apply to the next emote, or stay text without one.
 */
export function tokenize(text: string, ranges: EmoteRange[], lookup: EmoteLookup): MessagePart[] {
    const parts: MessagePart[] = [];
    let base: EmotePart | undefined;
    let prefixes: Atom[] = [];

    const pushText = (value: string) => {
        const last = parts.at(-1);
        if (last?.type === "text") last.text += value;
        else parts.push({ type: "text", text: value });
    };
    const pushSpace = (atom: Atom) => {
        if (atom.spaceBefore && parts.length > 0) pushText(" ");
    };
    const flushPrefixes = () => {
        for (const prefix of prefixes) {
            pushSpace(prefix);
            pushText(prefix.word);
        }
        prefixes = [];
    };
    const dropSpaceBefore = (part: EmotePart) => {
        const index = parts.lastIndexOf(part);
        const previous = parts[index - 1];
        if (previous?.type !== "text" || !previous.text.endsWith(" ")) return;
        previous.text = previous.text.slice(0, -1);
        if (!previous.text) parts.splice(index - 1, 1);
    };

    for (const atom of atomize(text, ranges)) {
        const emote = atom.emote ?? lookup(atom.word);

        if (emote?.bttvModifier) {
            prefixes.push(atom);
            base = undefined;
            continue;
        }

        if (emote && base && prefixes.length === 0) {
            if (emote.ffzModifierFlags !== undefined) {
                base.effects = applyFfzFlags(base.effects, emote.ffzModifierFlags);
                if (!(emote.ffzModifierFlags & FfzFlag.Hidden)) base.overlays.push(emote);
                if (base.effects.noSpace) dropSpaceBefore(base);
                continue;
            }
            if (emote.zeroWidth) {
                base.overlays.push(emote);
                continue;
            }
        }

        if (emote) {
            let effects = NO_EFFECTS;
            for (const prefix of prefixes) effects = applyBttvModifier(effects, prefix.word);
            const first = prefixes[0] ?? atom;
            prefixes = [];
            if (!effects.noSpace) pushSpace(first);
            base = { type: "emote", emote, overlays: [], effects };
            parts.push(base);
            continue;
        }

        flushPrefixes();
        pushSpace(atom);
        if (atom.word.length > 1 && atom.word.startsWith("@")) {
            parts.push({ type: "mention", text: atom.word });
        } else {
            pushText(atom.word);
        }
        base = undefined;
    }
    flushPrefixes();
    return parts;
}
