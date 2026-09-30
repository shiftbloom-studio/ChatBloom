// Twitch logins are 1–25 letters, digits and underscores, stored lowercase.
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * Whether the text is a Twitch login as Twitch stores it. The overlay joins only such names and
 * the relay accepts only such names, both through this one test, so that neither lets through
 * what the other refuses.
 */
export function isTwitchLogin(text: string): boolean {
    return LOGIN.test(text);
}

const TWITCH_URL = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*twitch\.tv(?:\/([^?#]*))?(?:[?#].*)?$/i;

// Path segments that come before the channel: pop-out chat, mod view, embeds, the dashboard.
const CHANNEL_PREFIXES = new Set(["popout", "moderator", "embed", "u"]);

// Pages of Twitch itself, which would otherwise pass as a channel name.
const TWITCH_PAGES = new Set([
    "directory",
    "downloads",
    "drops",
    "inventory",
    "jobs",
    "p",
    "search",
    "settings",
    "subscriptions",
    "turbo",
    "videos",
    "wallet",
]);

function channelOfPath(path: string): string | undefined {
    const [first, second] = path.split("/").filter((segment) => segment !== "");
    if (first === undefined || TWITCH_PAGES.has(first.toLowerCase())) return undefined;
    return CHANNEL_PREFIXES.has(first.toLowerCase()) ? second : first;
}

/**
 * Reads a Twitch channel from what people actually paste: a bare name, "@name", "#name" or a
 * link to the channel on Twitch, its chat, its mod view or its dashboard. Returns the
 * lowercase login, or undefined when the input names no channel.
 */
export function parseChannel(input: string): string | undefined {
    const text = input.trim();
    const url = TWITCH_URL.exec(text);
    const name = url ? channelOfPath(url[1] ?? "") : text.replace(/^[#@]/, "");
    const login = name?.toLowerCase();
    return login !== undefined && isTwitchLogin(login) ? login : undefined;
}

/** How much of a segment that names no channel is shown back, in characters. */
const SHOWN_LENGTH = 40;

// Control and format characters: line breaks, zero-width spaces, direction overrides. They
// would be invisible in the notice or turn it around, while they are often the very reason
// that a pasted name is refused.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export interface ChannelSegment {
    /** The channel to join, or undefined when the segment names none. */
    login: string | undefined;
    /**
     * The segment decoded, for telling people what their link says: shortened, and with
     * invisible characters replaced by "�".
     */
    text: string;
}

/**
 * Reads the channel of an overlay link from its path segment. The router hands the segment
 * over as it stands in the address, so "/chat/%C3%A9" arrives as "%C3%A9" and not as "é",
 * and "/chat/a,b" as "a,b", which Twitch would take for two channels. Accepts what
 * `parseChannel` accepts.
 */
export function readChannelSegment(segment: string): ChannelSegment {
    let text = segment;
    try {
        text = decodeURIComponent(segment);
    } catch {
        // A malformed escape such as "%zz" names no channel, and is shown as it stands.
    }
    const shown = Array.from(text.replace(INVISIBLE, "\uFFFD"));
    if (shown.length > SHOWN_LENGTH) shown.splice(SHOWN_LENGTH - 1, Infinity, "…");
    return { login: parseChannel(text), text: shown.join("") };
}
