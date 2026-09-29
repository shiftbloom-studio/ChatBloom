import { BTTV_MODIFIER_CODES } from "../effects";
import { ReconnectingSocket } from "../socket";
import { type Badge, type Emote, fetchJson } from "../types";

const API = "https://api.betterttv.net/3/cached";
const CDN = "https://cdn.betterttv.net";
const SOCKET_URL = "wss://sockets.betterttv.net/ws";

// BTTV's API has no zero-width flag; these are the emotes clients overlay by convention.
const ZERO_WIDTH = new Set([
    "cvHazmat",
    "cvMask",
    "IceCold",
    "SoSnowy",
    "SantaHat",
    "TopHat",
    "ReinDeer",
    "CandyCane",
]);

interface BTTVEmoteData {
    id: string;
    code: string;
    width?: number;
    height?: number;
    modifier?: boolean;
}

export function bttvEmote(data: BTTVEmoteData): Emote {
    return {
        provider: "bttv",
        id: data.id,
        name: data.code,
        images: {
            1: `${CDN}/emote/${data.id}/1x.webp`,
            2: `${CDN}/emote/${data.id}/2x.webp`,
            4: `${CDN}/emote/${data.id}/3x.webp`,
        },
        width: data.width,
        height: data.height,
        zeroWidth: ZERO_WIDTH.has(data.code),
        bttvModifier: (data.modifier && BTTV_MODIFIER_CODES.has(data.code)) || undefined,
    };
}

export async function fetchBTTVGlobalEmotes(): Promise<Emote[]> {
    return ((await fetchJson<BTTVEmoteData[]>(`${API}/emotes/global`)) ?? []).map(bttvEmote);
}

/** Channel and shared emotes; undefined when the channel has no BTTV account. */
export async function fetchBTTVChannelEmotes(twitchId: string): Promise<Emote[] | undefined> {
    const channel = await fetchJson<{
        channelEmotes: BTTVEmoteData[];
        sharedEmotes: BTTVEmoteData[];
    }>(`${API}/users/twitch/${encodeURIComponent(twitchId)}`);
    return channel && [...channel.channelEmotes, ...channel.sharedEmotes].map(bttvEmote);
}

/** Staff and supporter badges, keyed by Twitch user id. */
export async function fetchBTTVBadges(): Promise<Map<string, Badge>> {
    const users =
        (await fetchJson<{ providerId: string; badge: { description: string; svg: string } }[]>(
            `${API}/badges/twitch`,
        )) ?? [];
    return new Map(
        users.map((user) => [
            user.providerId,
            {
                provider: "bttv",
                id: user.badge.svg,
                title: user.badge.description,
                images: { 1: user.badge.svg },
            },
        ]),
    );
}

/** BTTV Pro username effects. `glow` and `flare` tint the chat color; the rest are textures. */
export type BTTVUsernameEffect =
    | "glow"
    | "flare"
    | "iridescence"
    | "supernova"
    | "midas"
    | "glacier"
    | "intergalactic";

export interface BTTVUser {
    twitchId: string;
    badge?: Badge;
    effect?: BTTVUsernameEffect;
    /** BTTV Pro personal emotes. */
    emotes: Emote[];
}

export interface BTTVSocketHandlers {
    onEmoteAdd: (channelId: string, emote: Emote) => void;
    onEmoteRename: (channelId: string, emoteId: string, name: string) => void;
    onEmoteRemove: (channelId: string, emoteId: string) => void;
    onUser: (user: BTTVUser) => void;
}

interface LookupUser {
    providerId: string;
    pro: boolean;
    glow?: boolean;
    usernameEffect?: BTTVUsernameEffect | null;
    badge?: { url: string } | null;
    emotes?: BTTVEmoteData[];
}

export function bttvUser(data: LookupUser): BTTVUser {
    return {
        twitchId: data.providerId,
        badge: data.badge
            ? {
                  provider: "bttv",
                  id: data.badge.url,
                  title: "BetterTTV Pro",
                  images: { 1: data.badge.url },
              }
            : undefined,
        effect: data.usernameEffect ?? (data.glow ? "glow" : undefined),
        emotes: data.pro ? (data.emotes ?? []).map(bttvEmote) : [],
    };
}

type SocketEvent =
    | { name: "emote_create"; data: { channel: string; emote: BTTVEmoteData } }
    | { name: "emote_update"; data: { channel: string; emote: { id: string; code: string } } }
    | { name: "emote_delete"; data: { channel: string; emoteId: string } }
    | { name: "lookup_user"; data: LookupUser };

const channelId = (name: string) => name.replace(/^twitch:/, "");

/**
 * The BTTV socket pushes live channel emote edits and announces BTTV users as they chat
 * (`lookup_user`), which carries their Pro badge, personal emotes and username effect.
 */
export class BTTVSocket {
    #socket: ReconnectingSocket;
    #channels = new Set<string>();

    constructor(handlers: BTTVSocketHandlers) {
        this.#socket = new ReconnectingSocket({
            label: "bttv-socket",
            url: () => SOCKET_URL,
            onOpen: () => {
                for (const id of this.#channels)
                    this.#send("join_channel", { name: `twitch:${id}` });
            },
            onMessage: (raw) => {
                const event = JSON.parse(raw) as SocketEvent;
                switch (event.name) {
                    case "emote_create":
                        handlers.onEmoteAdd(
                            channelId(event.data.channel),
                            bttvEmote(event.data.emote),
                        );
                        break;
                    case "emote_update":
                        handlers.onEmoteRename(
                            channelId(event.data.channel),
                            event.data.emote.id,
                            event.data.emote.code,
                        );
                        break;
                    case "emote_delete":
                        handlers.onEmoteRemove(channelId(event.data.channel), event.data.emoteId);
                        break;
                    case "lookup_user":
                        handlers.onUser(bttvUser(event.data));
                        break;
                }
            },
        });
        this.#socket.start();
    }

    join(twitchId: string): void {
        if (this.#channels.has(twitchId)) return;
        this.#channels.add(twitchId);
        this.#send("join_channel", { name: `twitch:${twitchId}` });
    }

    close(): void {
        this.#socket.stop();
    }

    #send(name: string, data: unknown): void {
        this.#socket.send(JSON.stringify({ name, data }));
    }
}
