export interface IrcMessage {
    tags: Record<string, string>;
    /** Nick from a `nick!user@host` prefix. */
    nick?: string;
    command: string;
    params: string[];
}

const TAG_ESCAPES: Record<string, string> = { ":": ";", s: " ", "\\": "\\", r: "\r", n: "\n" };

/** Undoes IRCv3 tag value escaping; an unknown escape keeps the escaped character. */
export function unescapeTag(value: string): string {
    return value.replace(/\\(.?)/g, (_, char: string) => TAG_ESCAPES[char] ?? char);
}

export function parseIrcLine(line: string): IrcMessage | undefined {
    const tags: Record<string, string> = {};
    let pos = 0;

    if (line.startsWith("@")) {
        const end = line.indexOf(" ");
        if (end === -1) return undefined;
        for (const tag of line.slice(1, end).split(";")) {
            const eq = tag.indexOf("=");
            if (eq === -1) tags[tag] = "";
            else tags[tag.slice(0, eq)] = unescapeTag(tag.slice(eq + 1));
        }
        pos = end + 1;
    }

    let nick: string | undefined;
    if (line[pos] === ":") {
        const end = line.indexOf(" ", pos);
        if (end === -1) return undefined;
        const prefix = line.slice(pos + 1, end);
        const bang = prefix.indexOf("!");
        if (bang !== -1) nick = prefix.slice(0, bang);
        pos = end + 1;
    }

    const trailingAt = line.indexOf(" :", pos);
    const middle = trailingAt === -1 ? line.slice(pos) : line.slice(pos, trailingAt);
    const [command, ...params] = middle.split(" ").filter(Boolean);
    if (!command) return undefined;
    if (trailingAt !== -1) params.push(line.slice(trailingAt + 2));

    return { tags, nick, command, params };
}

export interface EmoteRange {
    id: string;
    /** Inclusive Unicode code point indices, as Twitch sends them. */
    start: number;
    end: number;
}

/** Parses the `emotes` tag (`25:0-4,12-16/1902:6-10`) into ranges sorted by position. */
export function parseEmotesTag(tag: string | undefined): EmoteRange[] {
    if (!tag) return [];
    const ranges: EmoteRange[] = [];
    for (const entry of tag.split("/")) {
        const colon = entry.indexOf(":");
        if (colon === -1) continue;
        const id = entry.slice(0, colon);
        for (const span of entry.slice(colon + 1).split(",")) {
            const [start, end] = span.split("-").map(Number);
            if (Number.isInteger(start) && Number.isInteger(end)) ranges.push({ id, start, end });
        }
    }
    return ranges.sort((a, b) => a.start - b.start);
}

export interface BadgeRef {
    set: string;
    version: string;
}

/** Parses the `badges` / `source-badges` tag (`moderator/1,subscriber/12`). */
export function parseBadgesTag(tag: string | undefined): BadgeRef[] {
    if (!tag) return [];
    return tag.split(",").flatMap((badge) => {
        const slash = badge.indexOf("/");
        return slash === -1
            ? []
            : [{ set: badge.slice(0, slash), version: badge.slice(slash + 1) }];
    });
}

const CTCP = "\u0001";
const ACTION_PREFIX = `${CTCP}ACTION `;

/** Splits a `/me` CTCP action from its text. */
export function parseAction(text: string): { text: string; action: boolean } {
    if (!text.startsWith(ACTION_PREFIX)) return { text, action: false };
    const body = text.slice(ACTION_PREFIX.length);
    return { text: body.endsWith(CTCP) ? body.slice(0, -1) : body, action: true };
}
