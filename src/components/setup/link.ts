import { type OverlaySettings, overlayPath } from "../../lib/overlay/settings";

/** Shown in the prerendered page, which cannot know where it will be served from. */
export const PRODUCTION_ORIGIN = "https://petal.shiftbloom.studio";

/** Stands in for the channel: the sample chat is the same for every channel. */
export const PREVIEW_CHANNEL = "preview";

/**
 * The overlay in demo mode: sample messages, no chat connection. The path depends on
 * the look alone, so typing a channel does not reload the preview.
 */
export function previewPath(settings: OverlaySettings): string {
    const path = overlayPath(PREVIEW_CHANNEL, settings);
    return `${path}${path.includes("?") ? "&" : "?"}demo=1`;
}

/** The link a streamer pastes into OBS. */
export function overlayUrl(origin: string, channel: string, settings: OverlaySettings): string {
    return `${origin}${overlayPath(channel, settings)}`;
}
