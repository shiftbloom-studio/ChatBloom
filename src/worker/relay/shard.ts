import { isTwitchLogin } from "../../lib/channel";

/** FNV-1a: stable across isolates, deploys and runtimes, which `Math.random` seeds are not. */
export function stableHash(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function shardOf(channel: string, shards: number): number {
    // Anything but a positive count would yield `NaN`, which names no hub.
    if (!Number.isInteger(shards) || shards < 1) return 0;
    return stableHash(channel.toLowerCase()) % shards;
}

/**
 * Twitch logins are 4 to 25 characters today; older, shorter ones still exist. The test is the
 * overlay's own, so the relay never refuses a channel that an overlay link was accepted with.
 */
export function normaliseChannel(raw: string | null | undefined): string | undefined {
    const channel = raw?.replace(/^#/, "").toLowerCase();
    return channel && isTwitchLogin(channel) ? channel : undefined;
}
