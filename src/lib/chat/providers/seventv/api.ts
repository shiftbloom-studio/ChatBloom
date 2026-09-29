import { type Badge, type Emote, fetchJson } from "../../types";
import { type Paint, paintFromV4, V4_PAINT_FIELDS, type V4Paint } from "./paint";

const API = "https://7tv.io/v3";
const GQL_V4 = "https://7tv.io/v4/gql";

export interface SevenTVHost {
    url: string;
    files: { name: string; width: number; height: number; format: string }[];
}

export interface SevenTVActiveEmote {
    id: string;
    name: string;
    flags: number;
    data?: { id: string; name: string; flags: number; animated: boolean; host: SevenTVHost } | null;
}

export interface SevenTVEmoteSet {
    id: string;
    name: string;
    flags: number;
    emotes?: SevenTVActiveEmote[] | null;
}

/** Active emote flag: zero-width, rendered over the previous emote. */
const ACTIVE_ZERO_WIDTH = 1 << 0;
/** Emote set flag: a user's personal set, usable in any channel. */
export const SET_PERSONAL = 1 << 2;

function hostImages(host: SevenTVHost, format = "WEBP") {
    const files = host.files.filter((file) => file.format === format);
    const images: Emote["images"] = {};
    for (const file of files) {
        const density = Number.parseInt(file.name, 10);
        if (density >= 1 && density <= 4) {
            images[density as 1 | 2 | 3 | 4] = `https:${host.url}/${file.name}`;
        }
    }
    return { images, first: files[0] };
}

export function sevenTVEmote(active: SevenTVActiveEmote): Emote | undefined {
    if (!active.data) return undefined;
    const { images, first } = hostImages(active.data.host);
    if (!first) return undefined;
    return {
        provider: "7tv",
        id: active.id,
        name: active.name,
        images,
        width: first.width,
        height: first.height,
        zeroWidth: (active.flags & ACTIVE_ZERO_WIDTH) !== 0,
    };
}

export function sevenTVEmotes(set: SevenTVEmoteSet | null | undefined): Emote[] {
    return (set?.emotes ?? []).flatMap((active) => sevenTVEmote(active) ?? []);
}

export function sevenTVBadge(data: { id: string; tooltip: string; host: SevenTVHost }): Badge {
    return {
        provider: "7tv",
        id: data.id,
        title: data.tooltip,
        images: hostImages(data.host).images,
    };
}

export async function fetchSevenTVGlobalEmotes(): Promise<Emote[]> {
    return sevenTVEmotes(await fetchJson<SevenTVEmoteSet>(`${API}/emote-sets/global`));
}

export async function fetchSevenTVEmoteSet(id: string): Promise<SevenTVEmoteSet | undefined> {
    return fetchJson<SevenTVEmoteSet>(`${API}/emote-sets/${encodeURIComponent(id)}`);
}

export interface SevenTVChannel {
    /** The broadcaster's 7TV user id, for `user.*` EventAPI subscriptions. */
    userId: string;
    emoteSet?: SevenTVEmoteSet;
}

/** Returns undefined when the channel has no 7TV account. */
export async function fetchSevenTVChannel(twitchId: string): Promise<SevenTVChannel | undefined> {
    const connection = await fetchJson<{ user: { id: string }; emote_set: SevenTVEmoteSet | null }>(
        `${API}/users/twitch/${encodeURIComponent(twitchId)}`,
    );
    if (!connection) return undefined;
    return { userId: connection.user.id, emoteSet: connection.emote_set ?? undefined };
}

/**
 * Fetches paints from the v4 GraphQL API, which carries every layer. The v3 shape the EventAPI
 * sends only has the first one.
 */
export async function fetchSevenTVPaints(ids: string[]): Promise<Paint[]> {
    if (ids.length === 0) return [];
    const variables = Object.fromEntries(ids.map((id, i) => [`i${i}`, id]));
    const query = `query(${ids.map((_, i) => `$i${i}: Id!`).join(", ")}) { paints {
        ${ids.map((_, i) => `p${i}: paint(id: $i${i}) { ${V4_PAINT_FIELDS} }`).join("\n")}
    } }`;
    const result = await fetchJson<{ data?: { paints: Record<string, V4Paint | null> } }>(GQL_V4, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
    });
    return Object.values(result?.data?.paints ?? {}).flatMap((paint) =>
        paint ? [paintFromV4(paint)] : [],
    );
}
