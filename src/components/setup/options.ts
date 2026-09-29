import { DEFAULT_SETTINGS, type OverlaySettings } from "../../lib/overlay/settings";

export interface Option<Value> {
    value: Value;
    label: string;
}

export const SIZES: readonly Option<OverlaySettings["size"]>[] = [
    { value: 1, label: "Small" },
    { value: 2, label: "Medium" },
    { value: 3, label: "Large" },
];

export const STROKES: readonly Option<OverlaySettings["stroke"]>[] = [
    { value: 0, label: "Off" },
    { value: 1, label: "Thin" },
    { value: 2, label: "Medium" },
    { value: 3, label: "Thick" },
];

export const SHADOWS: readonly Option<OverlaySettings["shadow"]>[] = [
    { value: 0, label: "Off" },
    { value: 1, label: "Small" },
    { value: 2, label: "Medium" },
    { value: 3, label: "Large" },
];

export const EMOTE_SIZES: readonly Option<OverlaySettings["emotes"]>[] = [
    { value: 1, label: "Normal" },
    { value: 2, label: "Large" },
    { value: 3, label: "Huge" },
];

/** The settings behind "More options", which stay out of sight until someone asks for them. */
export const MORE_OPTIONS = [
    "custom",
    "emotes",
    "animate",
    "fade",
    "newline",
    "names",
    "badges",
    "homies",
    "bots",
    "commands",
    "caps",
    "ignore",
] as const satisfies readonly (keyof OverlaySettings)[];

/** How many of the given settings differ from the defaults. */
export function countChanged(
    settings: OverlaySettings,
    keys: readonly (keyof OverlaySettings)[],
): number {
    return keys.filter((key) => String(settings[key]) !== String(DEFAULT_SETTINGS[key])).length;
}
