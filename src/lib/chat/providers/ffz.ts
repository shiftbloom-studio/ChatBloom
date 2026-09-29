import { fetchJson } from "../gateway";
import { ReconnectingSocket } from "../socket";
import type { Badge, Emote, ImageSet } from "../types";

const API = "https://api.frankerfacez.com/v1";
const PUBSUB_URL = "wss://pubsub.workers.frankerfacez.com/ws";

type FFZUrls = Record<string, string | null>;

interface FFZEmoteData {
    id: number;
    name: string;
    width: number;
    height: number;
    modifier?: boolean;
    modifier_flags?: number;
    urls: FFZUrls;
    animated?: FFZUrls | null;
}

interface FFZSet {
    id: number;
    emoticons: FFZEmoteData[];
}

function imageSet(urls: FFZUrls | null | undefined): ImageSet {
    const images: ImageSet = {};
    for (const [density, url] of Object.entries(urls ?? {})) {
        if (url && ["1", "2", "4"].includes(density)) {
            images[Number(density) as 1 | 2 | 4] = url.startsWith("//") ? `https:${url}` : url;
        }
    }
    return images;
}

export function ffzEmote(data: FFZEmoteData): Emote {
    return {
        provider: "ffz",
        id: String(data.id),
        name: data.name,
        images: imageSet(data.animated ?? data.urls),
        width: data.width,
        height: data.height,
        ffzModifierFlags: data.modifier ? (data.modifier_flags ?? 0) : undefined,
    };
}

const setEmotes = (sets: Record<string, FFZSet>) =>
    new Map(Object.entries(sets).map(([id, set]) => [id, set.emoticons.map(ffzEmote)]));

export interface FFZGlobal {
    sets: Map<string, Emote[]>;
    /** Sets everyone can use. */
    defaultSets: string[];
    /** Sets granted to specific users, keyed by login. */
    userSets: Map<string, string[]>;
}

export async function fetchFFZGlobal(): Promise<FFZGlobal> {
    const data = await fetchJson<{
        default_sets: number[];
        sets: Record<string, FFZSet>;
        users: Record<string, string[]>;
    }>(`${API}/set/global`);
    const userSets = new Map<string, string[]>();
    for (const [setId, logins] of Object.entries(data?.users ?? {})) {
        for (const login of logins) userSets.set(login, [...(userSets.get(login) ?? []), setId]);
    }
    return {
        sets: setEmotes(data?.sets ?? {}),
        defaultSets: (data?.default_sets ?? []).map(String),
        userSets,
    };
}

export interface FFZRoom {
    sets: Map<string, Emote[]>;
    /** Custom moderator badge; replaces Twitch's in this channel. */
    moderatorBadge?: Badge;
    vipBadge?: Badge;
    /** Per-channel FFZ badges (e.g. bot), badge id to Twitch user ids. */
    userBadges: Map<string, string[]>;
}

/** Undefined when the channel has no FFZ room. */
export async function fetchFFZRoom(twitchId: string): Promise<FFZRoom | undefined> {
    const data = await fetchJson<{
        room: {
            mod_urls?: FFZUrls | null;
            vip_badge?: FFZUrls | null;
            user_badge_ids?: Record<string, number[]> | null;
        };
        sets: Record<string, FFZSet>;
    }>(`${API}/room/id/${encodeURIComponent(twitchId)}`);
    if (!data) return undefined;
    const { room } = data;
    return {
        sets: setEmotes(data.sets),
        // FFZ draws these over Twitch's moderator green and VIP pink.
        moderatorBadge: room.mod_urls
            ? {
                  provider: "ffz",
                  id: "moderator",
                  title: "Moderator",
                  images: imageSet(room.mod_urls),
                  background: "#34ae0a",
              }
            : undefined,
        vipBadge: room.vip_badge
            ? {
                  provider: "ffz",
                  id: "vip",
                  title: "VIP",
                  images: imageSet(room.vip_badge),
                  background: "#e005b9",
              }
            : undefined,
        userBadges: new Map(
            Object.entries(room.user_badge_ids ?? {}).map(([id, users]) => [id, users.map(String)]),
        ),
    };
}

export interface FFZBadge extends Badge {
    /** Twitch badge set this badge takes the place of, e.g. the bot badge replaces `moderator`. */
    replaces?: string;
}

export interface FFZBadges {
    badges: Map<string, FFZBadge>;
    /** Badge ids keyed by Twitch user id. */
    users: Map<string, string[]>;
}

export async function fetchFFZBadges(): Promise<FFZBadges> {
    const data = await fetchJson<{
        badges: {
            id: number;
            title: string;
            color: string;
            replaces: string | null;
            urls: FFZUrls;
        }[];
        users: Record<string, number[]>;
    }>(`${API}/badges/ids`);
    const users = new Map<string, string[]>();
    for (const [badgeId, ids] of Object.entries(data?.users ?? {})) {
        for (const id of ids) users.set(String(id), [...(users.get(String(id)) ?? []), badgeId]);
    }
    return {
        badges: new Map(
            (data?.badges ?? []).map((badge) => [
                String(badge.id),
                {
                    provider: "ffz",
                    id: String(badge.id),
                    title: badge.title,
                    images: imageSet(badge.urls),
                    background: badge.color,
                    replaces: badge.replaces ?? undefined,
                },
            ]),
        ),
        users,
    };
}

/** FFZ Add-On Pack supporter badges, keyed by Twitch user id. */
export async function fetchFFZAPBadges(): Promise<Map<string, Badge>> {
    const supporters =
        (await fetchJson<
            { id: string; tier: number; badge_color?: string; badge_is_colored?: number }[]
        >("https://api.ffzap.com/v1/supporters")) ?? [];
    const badges = new Map<string, Badge>();
    for (const supporter of supporters) {
        if (!supporter.tier) continue;
        const url = (size: number) => `https://api.ffzap.com/v1/user/badge/${supporter.id}/${size}`;
        badges.set(String(supporter.id), {
            provider: "ffzap",
            id: String(supporter.id),
            title: "FFZ:AP Supporter",
            images: { 1: url(1), 2: url(2), 4: url(3) },
            // Same rules as the add-on: tier 2 picks a color, tier 3 may ship a colored image.
            background:
                supporter.tier >= 3 && supporter.badge_is_colored
                    ? undefined
                    : (supporter.tier >= 2 && supporter.badge_color) || "#755000",
        });
    }
    return badges;
}

export interface FFZPubSubHandlers {
    onEmoteAdd: (setId: string, emote: Emote) => void;
    onEmoteRemove: (setId: string, emoteId: string) => void;
}

/** FFZ's pubsub (since FFZ 4.76) pushes live emote set edits for subscribed rooms. */
export class FFZPubSub {
    #socket: ReconnectingSocket;
    #topics = new Set(["global"]);

    constructor(handlers: FFZPubSubHandlers) {
        this.#socket = new ReconnectingSocket({
            label: "ffz-pubsub",
            url: () => {
                const url = new URL(PUBSUB_URL);
                for (const topic of this.#topics) url.searchParams.append("t", topic);
                return url.toString();
            },
            onMessage: (raw) => {
                const packet = JSON.parse(raw) as {
                    topic?: string;
                    data?: { cmd?: string; data?: Record<string, unknown> };
                };
                const payload = packet.data?.data;
                if (!packet.topic || !payload) return;
                if (packet.data?.cmd === "add_emote") {
                    handlers.onEmoteAdd(
                        String(payload.set_id),
                        ffzEmote(payload.emote as FFZEmoteData),
                    );
                } else if (packet.data?.cmd === "remove_emote") {
                    handlers.onEmoteRemove(String(payload.set_id), String(payload.emote_id));
                }
            },
        });
        this.#socket.start();
    }

    /** Topics live in the URL, so a new one means reconnecting. */
    subscribe(twitchId: string): void {
        const topic = `twitch/${twitchId}`;
        if (this.#topics.has(topic)) return;
        this.#topics.add(topic);
        this.#socket.reconnect(true);
    }

    close(): void {
        this.#socket.stop();
    }
}
