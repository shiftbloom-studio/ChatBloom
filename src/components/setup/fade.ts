/** The longest time the overlay accepts, in seconds. */
export const MAX_FADE = 600;

/** Offered when fading is switched on: long enough to read a line, short enough to keep up. */
export const SUGGESTED_FADE = 30;

/**
 * The seconds typed into the fade field, as a whole number from 1 to 600. Undefined while the
 * field holds no number, so that a half-typed value does not change the link.
 */
export function readFadeSeconds(text: string): number | undefined {
    const seconds = Number(text.trim().replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(seconds)) return undefined;
    return Math.min(Math.max(Math.round(seconds), 1), MAX_FADE);
}
