import { fetchJson } from "../gateway";
import type { Badge } from "../types";

/** Chatterino donator and contributor badges, keyed by Twitch user id. */
export async function fetchChatterinoBadges(): Promise<Map<string, Badge>> {
    const data = await fetchJson<{
        badges: {
            tooltip: string;
            image1: string;
            image2: string;
            image3: string;
            users: string[];
        }[];
    }>("https://api.chatterino.com/badges");
    const badges = new Map<string, Badge>();
    for (const badge of data?.badges ?? []) {
        for (const user of badge.users) {
            badges.set(user, {
                provider: "chatterino",
                id: badge.image1,
                title: badge.tooltip,
                images: { 1: badge.image1, 2: badge.image2, 3: badge.image3 },
            });
        }
    }
    return badges;
}
