/**
 * The look and the filters of the overlay, as they travel in the query string of an overlay
 * link. The start page writes them with `settingsQuery`, the overlay reads them with
 * `parseSettings`. A link without parameters gets `DEFAULT_SETTINGS`.
 */

// Relative, because the unit tests run the sources under Node, which knows no path aliases.
export { parseChannel as normaliseChannelInput } from "../channel";

export type FontId = string;

export interface OverlaySettings {
    /** Text size: small, medium, large. */
    size: 1 | 2 | 3;
    font: FontId;
    /** Text outline: off, thin, medium, thick. */
    stroke: 0 | 1 | 2 | 3;
    /** Text shadow: off, small, medium, large. */
    shadow: 0 | 1 | 2 | 3;
    /** Emote size relative to the text: normal, large, huge. */
    emotes: 1 | 2 | 3;
    /** New lines slide in. */
    animate: boolean;
    /** Seconds until a line fades out; 0 = never. A whole number, at most `MAX_FADE`. */
    fade: number;
    badges: boolean;
    /** Show messages of well-known bots. */
    bots: boolean;
    /** Show messages that start with "!". */
    commands: boolean;
    /** Small caps. */
    caps: boolean;
    /**
     * Additional logins whose messages are hidden: lowercase, sorted, unique, at most
     * `MAX_IGNORED`.
     */
    ignore: string[];
    /**
     * Name of a font installed on the computer that shows the overlay, "" for none. It comes
     * before `font`, which stays the fallback. Only what `parseCustomFont` lets through.
     */
    custom: string;
    /** The message starts on a line of its own, below badges and name. Parameter `nl`. */
    newline: boolean;
    /** Show the names of the chatters. */
    names: boolean;
    /** Show Homies badges, which the overlay has to ask a third party for. */
    homies: boolean;
}

// Fonts the site serves itself (declared in brand.css and app.css) and system font stacks: the
// overlay never asks a font host.
export const FONTS: readonly { id: FontId; label: string; family: string }[] = [
    // The stack the overlay had before it had settings: Roboto where it is installed, else the
    // font of the operating system.
    { id: "system", label: "System", family: '"Roboto", system-ui, sans-serif' },
    { id: "sans", label: "General Sans", family: '"General Sans", system-ui, sans-serif' },
    { id: "display", label: "Clash Display", family: '"Clash Display", system-ui, sans-serif' },
    { id: "mono", label: "JetBrains Mono", family: '"JetBrains Mono", ui-monospace, monospace' },
    { id: "serif", label: "Serif", family: 'Georgia, "Times New Roman", serif' },
    { id: "alsina", label: "Alsina", family: '"Alsina", system-ui, sans-serif' },
];

// The look of the overlay before it had settings, so links without parameters keep it.
export const DEFAULT_SETTINGS: OverlaySettings = {
    size: 1,
    font: "system",
    stroke: 0,
    shadow: 1,
    emotes: 1,
    animate: true,
    fade: 0,
    badges: true,
    bots: true,
    commands: true,
    caps: false,
    ignore: [],
    custom: "",
    newline: false,
    names: true,
    homies: false,
};

export const MAX_FADE = 600;
export const MAX_IGNORED = 20;
export const MAX_CUSTOM_FONT = 40;

const LOGIN = /^[a-z0-9_]{1,25}$/;

// Letters and digits of any script, space, hyphen, underscore and dot. The name ends up in a
// quoted string of a style sheet, so nothing that could end the string or start an escape.
const FONT_NAME = /^[\p{L}\p{N} ._-]+$/u;

/**
 * The name of an installed font as the overlay accepts it: trimmed, or "" when it is empty,
 * too long or contains anything a font name does not need.
 */
export function parseCustomFont(input: string): string {
    const name = input.trim();
    // Counted in characters, as a streamer counts them, not in UTF-16 units.
    return FONT_NAME.test(name) && [...name].length <= MAX_CUSTOM_FONT ? name : "";
}

function level<T extends number>(value: string | null, allowed: readonly T[], fallback: T): T {
    const text = value?.trim() ?? "";
    const match = /^\d$/.test(text) ? allowed.find((known) => known === Number(text)) : undefined;
    return match ?? fallback;
}

function flag(value: string | null, fallback: boolean): boolean {
    const text = value?.trim().toLowerCase();
    if (text === "1" || text === "true") return true;
    if (text === "0" || text === "false") return false;
    return fallback;
}

function seconds(value: string | null, fallback: number): number {
    const text = value?.trim() ?? "";
    if (!/^\d{1,3}$/.test(text)) return fallback;
    const parsed = Number(text);
    return parsed <= MAX_FADE ? parsed : fallback;
}

function font(value: string | null, fallback: FontId): FontId {
    const id = value?.trim().toLowerCase();
    return FONTS.find((known) => known.id === id)?.id ?? fallback;
}

/** Reads the settings of an overlay link. Unknown and invalid values fall back to the default. */
export function parseSettings(params: URLSearchParams): OverlaySettings {
    return {
        size: level(params.get("size"), [1, 2, 3], DEFAULT_SETTINGS.size),
        font: font(params.get("font"), DEFAULT_SETTINGS.font),
        stroke: level(params.get("stroke"), [0, 1, 2, 3], DEFAULT_SETTINGS.stroke),
        shadow: level(params.get("shadow"), [0, 1, 2, 3], DEFAULT_SETTINGS.shadow),
        emotes: level(params.get("emotes"), [1, 2, 3], DEFAULT_SETTINGS.emotes),
        animate: flag(params.get("animate"), DEFAULT_SETTINGS.animate),
        fade: seconds(params.get("fade"), DEFAULT_SETTINGS.fade),
        badges: flag(params.get("badges"), DEFAULT_SETTINGS.badges),
        bots: flag(params.get("bots"), DEFAULT_SETTINGS.bots),
        commands: flag(params.get("commands"), DEFAULT_SETTINGS.commands),
        caps: flag(params.get("caps"), DEFAULT_SETTINGS.caps),
        ignore: parseIgnoreList(params.getAll("ignore").join(",")),
        custom: parseCustomFont(params.get("custom") ?? ""),
        newline: flag(params.get("nl"), DEFAULT_SETTINGS.newline),
        names: flag(params.get("names"), DEFAULT_SETTINGS.names),
        homies: flag(params.get("homies"), DEFAULT_SETTINGS.homies),
    };
}

/**
 * The query string of an overlay link: only what differs from the default, always in the same
 * order, so the same settings always give the same link. Every value but the name of a custom
 * font consists of characters that need no escaping, which keeps the link readable.
 */
export function settingsQuery(settings: OverlaySettings): string {
    const pairs: string[] = [];
    const add = (
        key: keyof OverlaySettings,
        value: string | number | boolean,
        parameter: string = key,
    ) => {
        if (value === DEFAULT_SETTINGS[key]) return;
        pairs.push(`${parameter}=${typeof value === "boolean" ? Number(value) : value}`);
    };
    add("size", settings.size);
    add("font", settings.font);
    add("stroke", settings.stroke);
    add("shadow", settings.shadow);
    add("emotes", settings.emotes);
    add("animate", settings.animate);
    add("fade", settings.fade);
    add("badges", settings.badges);
    add("bots", settings.bots);
    add("commands", settings.commands);
    add("caps", settings.caps);
    if (settings.ignore.length > 0) pairs.push(`ignore=${settings.ignore.join(",")}`);
    // Sanitised here as well: a name that the overlay would drop has no place in the link.
    add("custom", encodeURIComponent(parseCustomFont(settings.custom)));
    add("newline", settings.newline, "nl");
    add("names", settings.names);
    add("homies", settings.homies);
    return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * Turns what a streamer typed ("Nightbot, @SomeBot otherbot") into the list of the settings.
 * Names that cannot be Twitch logins are dropped, and so is everything after `MAX_IGNORED`
 * names.
 */
export function parseIgnoreList(input: string): string[] {
    const logins = new Set<string>();
    for (const word of input.split(/[\s,;]+/)) {
        const login = word.replace(/^@/, "").toLowerCase();
        if (LOGIN.test(login) && logins.size < MAX_IGNORED) logins.add(login);
    }
    return [...logins].sort();
}

export function overlayPath(channel: string, settings: OverlaySettings): string {
    return `/chat/${channel}${settingsQuery(settings)}`;
}

// Accounts of chat bot services. Lowercase, like the logins Twitch sends.
export const BOT_LOGINS: ReadonlySet<string> = new Set([
    "amazefulbot",
    "blerp",
    "botisimo",
    "botrixoficial",
    "buttsbot",
    "creatisbot",
    "dixperbro",
    "fossabot",
    "frostytoolsdotcom",
    "kofistreambot",
    "lolrankbot",
    "lumiastream",
    "moobot",
    "nightbot",
    "own3d",
    "playwithviewersbot",
    "pokemoncommunitygame",
    "pretzelrocks",
    "rainmaker",
    "restreambot",
    "sery_bot",
    "songlistbot",
    "soundalerts",
    "stay_hydrated_bot",
    "streamelements",
    "streamlabs",
    "streamstickers",
    "supibot",
    "tangiabot",
    "thepositivebot",
    "triggerfyre",
    "wizebot",
    "wzbot",
]);

// The badge Twitch itself puts on messages that a bot sends through its chat API.
const BOT_BADGE = "bot-badge";

/** What the filters look at; every chat message has these. */
export interface FilteredMessage {
    login: string;
    text: string;
    badgeRefs: readonly { set: string }[];
}

export function isBotMessage(message: FilteredMessage): boolean {
    return (
        BOT_LOGINS.has(message.login.toLowerCase()) ||
        message.badgeRefs.some((badge) => badge.set === BOT_BADGE)
    );
}

/** Whether the overlay shows a message under the given settings. */
export function isMessageShown(message: FilteredMessage, settings: OverlaySettings): boolean {
    if (settings.ignore.includes(message.login.toLowerCase())) return false;
    if (!settings.bots && isBotMessage(message)) return false;
    if (!settings.commands && message.text.startsWith("!")) return false;
    return true;
}
