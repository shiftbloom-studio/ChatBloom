/**
 * Emote modifier effects from BTTV (`w!`, `h!`, ...) and FFZ (`ffzX`, `ffzHyper`, ...), reduced to
 * CSS. Static transforms and filters are also exposed as custom properties so the animation
 * keyframes in `effects.css` can compose with them instead of overwriting them.
 */
export interface EmoteEffects {
    transforms: string[];
    filters: string[];
    animations: string[];
    transformOrigin?: string;
    /** FFZ GrowX: multiply the natural width. */
    widthScale: number;
    /** BTTV `w!`: force this width-to-height ratio. */
    aspectRatio?: number;
    /** Removes the space before the emote. */
    noSpace: boolean;
    /** FFZ Slide: the image scrolls horizontally inside its box. */
    slide: boolean;
}

export const NO_EFFECTS: EmoteEffects = {
    transforms: [],
    filters: [],
    animations: [],
    widthScale: 1,
    noSpace: false,
    slide: false,
};

export function hasEffects(effects: EmoteEffects): boolean {
    return effects !== NO_EFFECTS;
}

/**
 * The width in px that the effects give an emote of `height` px and the given ratio of width to
 * height, or undefined where they leave the width to the image. A sliding emote is a background
 * with no image to size its box, so it always gets a width.
 */
export function effectWidth(
    effects: EmoteEffects,
    height: number,
    ratio: number,
): number | undefined {
    if (effects.aspectRatio) return height * effects.aspectRatio;
    if (effects.widthScale === 1 && !effects.slide) return undefined;
    return height * ratio * effects.widthScale;
}

const CURSED = "grayscale(1) brightness(0.7) contrast(2.5)";

type Change = Partial<Omit<EmoteEffects, "transforms" | "filters" | "animations">> & {
    transform?: string;
    filter?: string;
    animation?: string;
};

function apply(effects: EmoteEffects, change: Change): EmoteEffects {
    const { transform, filter, animation, ...rest } = change;
    return {
        ...effects,
        ...rest,
        transforms: transform ? [...effects.transforms, transform] : effects.transforms,
        filters: filter ? [...effects.filters, filter] : effects.filters,
        animations: animation ? [...effects.animations, animation] : effects.animations,
    };
}

const BTTV_MODIFIERS: Record<string, Change> = {
    "w!": { aspectRatio: 4 },
    "h!": { transform: "scaleX(-1)" },
    "v!": { transform: "scaleY(-1)" },
    "z!": { noSpace: true },
    "c!": { filter: CURSED },
    "l!": { transform: "rotate(-90deg)" },
    "r!": { transform: "rotate(90deg)" },
    "p!": { animation: "cb-fx-party 1.5s linear infinite" },
    "s!": { animation: "cb-fx-bttv-shake 0.5s step-start infinite" },
};

export const BTTV_MODIFIER_CODES = new Set(Object.keys(BTTV_MODIFIERS));

export function applyBttvModifier(effects: EmoteEffects, code: string): EmoteEffects {
    const change = BTTV_MODIFIERS[code];
    return change ? apply(effects, change) : effects;
}

/** FFZ `modifier_flags` bits, in FFZ's order. */
export const FfzFlag = {
    Hidden: 1 << 0,
    FlipX: 1 << 1,
    FlipY: 1 << 2,
    GrowX: 1 << 3,
    Slide: 1 << 4,
    Appear: 1 << 5,
    Leave: 1 << 6,
    Rotate: 1 << 7,
    Rotate90: 1 << 8,
    Greyscale: 1 << 9,
    Sepia: 1 << 10,
    Rainbow: 1 << 11,
    HyperRed: 1 << 12,
    Shake: 1 << 13,
    Cursed: 1 << 14,
    Jam: 1 << 15,
    Bounce: 1 << 16,
    NoSpace: 1 << 17,
} as const;

const FFZ_EFFECTS: [flag: number, change: Change][] = [
    [FfzFlag.FlipX, { transform: "scaleX(-1)" }],
    [FfzFlag.FlipY, { transform: "scaleY(-1)" }],
    [FfzFlag.GrowX, { widthScale: 2 }],
    [FfzFlag.Slide, { slide: true }],
    [FfzFlag.Rotate90, { transform: "rotate(90deg)" }],
    [FfzFlag.Greyscale, { filter: "grayscale(1)" }],
    [FfzFlag.Sepia, { filter: "sepia(1)" }],
    [
        FfzFlag.HyperRed,
        { filter: "brightness(0.2) sepia(1) brightness(2.2) contrast(3) saturate(8)" },
    ],
    [FfzFlag.Cursed, { filter: CURSED }],
    [FfzFlag.Rainbow, { animation: "cb-fx-rainbow 2s linear infinite" }],
    [FfzFlag.Shake, { animation: "cb-fx-shake 0.1s linear infinite" }],
    [FfzFlag.Jam, { animation: "cb-fx-jam 0.6s linear infinite" }],
    [
        FfzFlag.Bounce,
        { animation: "cb-fx-bounce 0.5s linear infinite", transformOrigin: "bottom center" },
    ],
    [FfzFlag.NoSpace, { noSpace: true }],
];

export function applyFfzFlags(effects: EmoteEffects, flags: number): EmoteEffects {
    let result = effects;
    for (const [flag, change] of FFZ_EFFECTS) {
        if (flags & flag) result = apply(result, change);
    }

    // These three animate the whole transform, so they are exclusive like in FFZ.
    const appear = (flags & FfzFlag.Appear) !== 0;
    const leave = (flags & FfzFlag.Leave) !== 0;
    if (appear && leave) result = apply(result, { animation: "cb-fx-in-out 6s linear infinite" });
    else if (appear) result = apply(result, { animation: "cb-fx-appear 3s linear infinite" });
    else if (leave) result = apply(result, { animation: "cb-fx-leave 3s linear infinite" });
    else if (flags & FfzFlag.Rotate && !(flags & FfzFlag.Slide)) {
        result = apply(result, { animation: "cb-fx-spin 1.5s linear infinite" });
    }
    return result;
}
