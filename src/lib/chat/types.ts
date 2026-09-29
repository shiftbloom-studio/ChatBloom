/** Image URLs keyed by pixel density, e.g. `{ 1: ".../1x.webp", 2: ".../2x.webp", 4: ".../4x.webp" }`. */
export type ImageSet = Partial<Record<1 | 2 | 3 | 4, string>>;

export type EmoteProvider = "twitch" | "7tv" | "bttv" | "ffz";

export interface Emote {
    provider: EmoteProvider;
    id: string;
    name: string;
    images: ImageSet;
    /** Size at 1x, when the provider reports it. */
    width?: number;
    height?: number;
    /** Stacks on top of the previous emote instead of taking its own space (7TV, BTTV). */
    zeroWidth?: boolean;
    /** FFZ modifier emote: its flags apply to the previous emote. */
    ffzModifierFlags?: number;
    /** BTTV prefix modifier such as `w!`: applies to the next emote and never renders itself. */
    bttvModifier?: boolean;
}

export type BadgeProvider = "twitch" | "7tv" | "bttv" | "ffz" | "ffzap" | "chatterino";

export interface Badge {
    provider: BadgeProvider;
    id: string;
    title: string;
    images: ImageSet;
    /** Painted behind the badge image; FFZ ships white-on-transparent badges. */
    background?: string;
}

export function srcset(images: ImageSet): string {
    return Object.entries(images)
        .map(([density, url]) => `${url} ${density}x`)
        .join(", ");
}

export function smallestImage(images: ImageSet): string | undefined {
    return images[1] ?? images[2] ?? images[3] ?? images[4];
}
