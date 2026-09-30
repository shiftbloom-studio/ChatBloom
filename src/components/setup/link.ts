import { type OverlaySettings, overlayPath } from "../../lib/overlay/settings";

/** Shown in the prerendered page, which cannot know where it will be served from. */
export const PRODUCTION_ORIGIN = "https://petal.shiftbloom.studio";

/** Stands in for the channel while none is typed: the sample chat with Twitch's global badges. */
export const PREVIEW_CHANNEL = "preview";

/**
 * The overlay in demo mode: sample messages, no chat connection. With a channel, the sample
 * chat wears that channel's own subscriber badges.
 */
export function previewPath(settings: OverlaySettings, channel?: string): string {
    const path = overlayPath(channel ?? PREVIEW_CHANNEL, settings);
    return `${path}${path.includes("?") ? "&" : "?"}demo=1`;
}

/** The link a streamer pastes into OBS. */
export function overlayUrl(origin: string, channel: string, settings: OverlaySettings): string {
    return `${origin}${overlayPath(channel, settings)}`;
}
