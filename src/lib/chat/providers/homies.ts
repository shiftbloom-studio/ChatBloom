import type { Badge, ImageSet } from "../types";

/**
 * A badge like those of the chat session, from a provider that the session does not know: the
 * overlay asks for Homies badges itself, and only when the link switches them on.
 */
export type HomiesBadge = Omit<Badge, "provider"> & { provider: "homies" };

/** The Homies badges of every holder, by Twitch user id. */
export type HomiesBadges = ReadonlyMap<string, readonly HomiesBadge[]>;

// In display order, as ChatIS showed them: the two lists of shared badges (developer, supporter,
// moderator, ...) and then the custom badges, which is one entry per user and about 4 MB.
// Homies is asked itself: the data gateway of the overlay's origin does not serve these lists.
const LISTS = [
    "https://itzalex.github.io/badges",
    "https://itzalex.github.io/badges2",
    "https://chatterinohomies.com/api/badges/list",
];

// Badge images load from these two hosts only, which are the ones the privacy policy names.
// No whitespace or commas, so that a URL cannot add candidates to a `srcset`.
const IMAGE_URL = /^https:\/\/(cdn\.chatterinohomies\.com|itzalex\.github\.io)\/[^\s,]+$/;

/** Four times the custom list of September 2026. The overlay does not read a longer answer. */
const MAX_BYTES = 16 * 1024 * 1024;

/** The lists are applied together, so a server that hangs may hold back the others this long. */
const TIMEOUT_MS = 20_000;

/** An entry as the lists should have it; they are outside our control, so nothing is trusted. */
interface ListedBadge {
    tooltip?: unknown;
    /** 18, 36 and 72 px. */
    image1?: unknown;
    image2?: unknown;
    image3?: unknown;
    /** Shared badges list their holders; an unused badge lists `""`. */
    users?: unknown;
    /** Custom badges belong to one user. */
    userId?: unknown;
}

function imageUrl(value: unknown): string | undefined {
    return typeof value === "string" && IMAGE_URL.test(value) ? value : undefined;
}

function homiesBadge(raw: ListedBadge): HomiesBadge | undefined {
    const images: ImageSet = {};
    const small = imageUrl(raw.image1);
    const medium = imageUrl(raw.image2);
    const large = imageUrl(raw.image3);
    if (small) images[1] = small;
    if (medium) images[2] = medium;
    if (large) images[4] = large;
    const id = small ?? medium ?? large;
    if (!id) return undefined;
    return {
        provider: "homies",
        id,
        title: typeof raw.tooltip === "string" ? raw.tooltip : "Homies",
        images,
    };
}

/** The body as text, given up as soon as it is longer than {@link MAX_BYTES}. */
async function readText(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("the answer is empty");
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
            // Stops the download; whether that works out does not change the outcome.
            reader.cancel().catch(() => {});
            throw new Error(`the answer is longer than ${MAX_BYTES} bytes`);
        }
        text += decoder.decode(value, { stream: true });
    }
}

async function fetchList(url: string): Promise<ListedBadge[]> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            // chatterinohomies.com answers with sign-in cookies, which the overlay must never keep.
            credentials: "omit",
            // A redirect would lead to a host that the privacy policy does not name.
            redirect: "error",
            signal: timeout.signal,
        });
        if (!response.ok) throw new Error(`it answered ${response.status}`);
        const data: unknown = JSON.parse(await readText(response));
        const list = typeof data === "object" && data !== null && "badges" in data && data.badges;
        if (!Array.isArray(list)) throw new Error("the answer has no list of badges");
        return list.filter((entry) => typeof entry === "object" && entry !== null);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Chatterino Homies badges, keyed by Twitch user id: every shared badge that lists the user,
 * followed by their custom badge. A list that fails to load is left out, so this never rejects.
 */
export async function fetchHomiesBadges(): Promise<Map<string, HomiesBadge[]>> {
    const lists = await Promise.all(
        LISTS.map((url) =>
            fetchList(url).catch((error): ListedBadge[] => {
                console.warn(`[chat] loading ${url} failed`, error);
                return [];
            }),
        ),
    );
    const badges = new Map<string, HomiesBadge[]>();
    for (const raw of lists.flat()) {
        const badge = homiesBadge(raw);
        if (!badge) continue;
        for (const user of Array.isArray(raw.users) ? raw.users : [raw.userId]) {
            // Twitch user ids are digits only, which also drops the `""` of an unused badge.
            const id = typeof user === "string" || typeof user === "number" ? String(user) : "";
            if (!/^\d+$/.test(id)) continue;
            const held = badges.get(id);
            if (!held) badges.set(id, [badge]);
            else if (!held.some((other) => other.id === badge.id)) held.push(badge);
        }
    }
    return badges;
}
