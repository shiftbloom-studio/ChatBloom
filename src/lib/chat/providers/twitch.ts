import { fetchJson } from "../gateway";
import type { BadgeRef } from "../irc/parse";
import type { Badge, Emote } from "../types";

export function twitchEmote(id: string, name: string): Emote {
    // `default` serves the animated variant when there is one.
    const base = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark`;
    return {
        provider: "twitch",
        id,
        name,
        images: { 1: `${base}/1.0`, 2: `${base}/2.0`, 4: `${base}/3.0` },
        width: 28,
        height: 28,
    };
}

interface IvrBadgeSet {
    set_id: string;
    versions: {
        id: string;
        title: string;
        image_url_1x: string;
        image_url_2x: string;
        image_url_4x: string;
    }[];
}

/** Twitch badges keyed by `set/version`. */
export type TwitchBadges = Map<string, Badge>;

// Helix's badge endpoints need an app token and the legacy anonymous endpoint is gone, so
// badges come from IVR, a public community API that mirrors Helix with CORS enabled.
const IVR_BADGES = "https://api.ivr.fi/v2/twitch/badges";

async function fetchIvrBadges(url: string): Promise<TwitchBadges> {
    const sets = (await fetchJson<IvrBadgeSet[]>(url)) ?? [];
    const badges: TwitchBadges = new Map();
    for (const set of sets) {
        for (const version of set.versions) {
            badges.set(`${set.set_id}/${version.id}`, {
                provider: "twitch",
                id: `${set.set_id}/${version.id}`,
                title: version.title,
                images: {
                    1: version.image_url_1x,
                    2: version.image_url_2x,
                    4: version.image_url_4x,
                },
            });
        }
    }
    return badges;
}

export const fetchTwitchGlobalBadges = () => fetchIvrBadges(`${IVR_BADGES}/global`);

/** The id of a channel by its login, undefined when Twitch has no such channel. */
export async function fetchTwitchUserId(login: string): Promise<string | undefined> {
    const users = await fetchJson<{ id: string }[]>(
        `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`,
    );
    return users?.[0]?.id;
}

export const fetchTwitchChannelBadges = (roomId: string) =>
    fetchIvrBadges(`${IVR_BADGES}/channel?id=${encodeURIComponent(roomId)}`);

export function resolveTwitchBadges(
    refs: BadgeRef[],
    channel: TwitchBadges | undefined,
    global: TwitchBadges,
): Badge[] {
    return refs.flatMap(({ set, version }) => {
        const badge = channel?.get(`${set}/${version}`) ?? global.get(`${set}/${version}`);
        return badge ? [badge] : [];
    });
}

// The palette Twitch assigns to users who never picked a color.
const DEFAULT_COLORS = [
    "#FF0000",
    "#0000FF",
    "#008000",
    "#B22222",
    "#FF7F50",
    "#9ACD32",
    "#FF4500",
    "#2E8B57",
    "#DAA520",
    "#D2691E",
    "#5F9EA0",
    "#1E90FF",
    "#FF69B4",
    "#8A2BE2",
    "#00FF7F",
];

export function defaultColor(login: string): string {
    let hash = 0;
    for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return DEFAULT_COLORS[hash % DEFAULT_COLORS.length];
}

/** Lightens colors too dark to read on a stream, keeping their hue. */
export function readableColor(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const value = Number.parseInt(match[1], 16);
    const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff];
    const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
    if (luminance >= 0.3) return `#${match[1]}`;
    const mix = 0.3 - luminance + 0.25;
    const lifted = channels.map((c) => Math.round(c + (255 - c) * mix));
    return `#${lifted.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
