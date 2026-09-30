import type { EmotePart } from "../chat/tokenize";
import type { Emote, ImageSet } from "../chat/types";

/**
 * Width descriptors scaled from a base height, so the browser picks an image for the rendered
 * size rather than only for the device pixel ratio. Aspect ratio doesn't matter here: it is the
 * same at every density.
 */
export function sizedSrcset(images: ImageSet, baseHeight: number): string {
    return Object.entries(images)
        .map(([density, url]) => `${url} ${Math.round(baseHeight * Number(density))}w`)
        .join(", ");
}

/**
 * The ratio of width to height an emote is laid out with, so that it takes its room in the line
 * before its image has arrived. The size the provider reports comes first, then the size of the
 * loaded image. Without either the emote is taken to be square: BTTV reports the size only of
 * emotes that are not square, and 7TV and FFZ report it for every emote.
 */
export function emoteRatio(emote: Pick<Emote, "width" | "height">, loaded?: number): number {
    if (emote.width && emote.height) return emote.width / emote.height;
    return loaded && Number.isFinite(loaded) ? loaded : 1;
}

/**
 * The CSS `aspect-ratio` of an emote image. An image has no width until it has loaded, so without
 * it every emote would push the rest of its line aside as it arrives. The height comes from the
 * stylesheet, and this gives the width. With `auto`, the ratio of the image takes over once it has
 * loaded, for the few emotes whose files are not the size their provider reports.
 */
export function emoteAspectRatio(emote: Pick<Emote, "width" | "height">): string {
    return `auto ${emoteRatio(emote)} / 1`;
}

/**
 * The image set without the file that failed to load, or undefined when there is nothing left
 * to try. A failure is the file the browser picked from the srcset, not the whole set, and the
 * browser does not move on to another file by itself.
 *
 * `failed` is the image's `currentSrc`, which is the absolute URL, except after a load that was
 * blocked by a cross-origin check or a content security policy: then Chromium reports the URL as
 * the srcset spells it. So both it and the files of the set are resolved against `base`.
 */
export function withoutImage(images: ImageSet, failed: string, base: string): ImageSet | undefined {
    const failedUrl = failed ? URL.parse(failed, base)?.href : undefined;
    const rest: ImageSet = {};
    let found = false;
    for (const [density, url] of Object.entries(images)) {
        if (failedUrl !== undefined && URL.parse(url, base)?.href === failedUrl) found = true;
        else rest[Number(density) as keyof ImageSet] = url;
    }
    // A failure that matches no file of the set would try the same files again, and forever.
    if (!found || Object.keys(rest).length === 0) return undefined;
    return rest;
}

/** What is left to show of an emote and the emotes stacked on it, once some images have failed. */
export interface EmoteRest {
    /** Text before the stack: the name of the emote below it, when its image failed. */
    before: string;
    /** The emote below the stack, unless its image failed. */
    base?: Emote;
    /** The stacked emotes whose images have not failed. */
    overlays: Emote[];
    /** Text after the stack: the names of the stacked emotes whose images failed. */
    after: string;
}

/**
 * An emote whose image cannot be loaded becomes its name, which is what the chatter typed. The
 * line then reads as it does in a chat client that does not know the emote, such as Twitch's own
 * for a 7TV emote, where a gap would lose a word of it. Zero-width emotes whose base failed stand
 * on their own after its name, as they do where no emote comes before them.
 */
export function emoteRest(
    part: Pick<EmotePart, "emote" | "overlays">,
    failed: readonly Emote[],
): EmoteRest {
    const baseFailed = failed.includes(part.emote);
    const overlays = part.overlays.filter((overlay) => !failed.includes(overlay));
    return {
        before: baseFailed ? `${part.emote.name}${overlays.length > 0 ? " " : ""}` : "",
        base: baseFailed ? undefined : part.emote,
        overlays,
        after: part.overlays
            .filter((overlay) => failed.includes(overlay))
            .map((overlay) => ` ${overlay.name}`)
            .join(""),
    };
}
