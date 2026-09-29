// Twitch logins are 1–25 letters, digits and underscores, stored lowercase.
const LOGIN = /^[a-z0-9_]{1,25}$/;

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
    return login !== undefined && LOGIN.test(login) ? login : undefined;
}
