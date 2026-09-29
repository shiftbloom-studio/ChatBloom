import { DEFAULT_SETTINGS, FONTS, type OverlaySettings, parseCustomFont } from "./settings";

const TEXT_SCALE: Record<OverlaySettings["size"], number> = { 1: 1, 2: 1.5, 3: 2 };
const EMOTE_SCALE: Record<OverlaySettings["emotes"], number> = { 1: 1, 2: 1.5, 3: 2 };

/** Factor on everything that belongs to the text: font size, badges, spacing, shadows. */
export function textScale(settings: OverlaySettings): number {
    return TEXT_SCALE[settings.size];
}

/** Factor on the height of emotes: they grow with the text, and on top of that on their own. */
export function emoteScale(settings: OverlaySettings): number {
    return TEXT_SCALE[settings.size] * EMOTE_SCALE[settings.emotes];
}

/**
 * The font stack to set on the overlay. `undefined` for the default font: the stylesheet
 * carries that one, and a stack set from outside (custom CSS in OBS) keeps its effect.
 * A custom font leads the stack of the chosen font, which shows where it is not installed.
 */
export function fontFamily(settings: OverlaySettings): string | undefined {
    const stack = FONTS.find((font) => font.id === settings.font)?.family;
    // Checked again where the name turns into CSS, for settings that no link has parsed. What
    // passes cannot end the quoted string it is put into.
    const custom = parseCustomFont(settings.custom);
    if (custom !== "") return stack ? `"${custom}", ${stack}` : `"${custom}"`;
    return settings.font === DEFAULT_SETTINGS.font ? undefined : stack;
}
