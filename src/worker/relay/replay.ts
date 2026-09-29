import { type IrcLineInfo, tagValue, withTag } from "./irc";

interface ReplayEntry {
    line: string;
    id: string | undefined;
    userId: string | undefined;
}

/**
 * The last chat lines of one channel, kept in memory only, for overlays that join late or
 * reload. Moderation is applied to the buffer so a deleted message is never replayed.
 */
export class ReplayBuffer {
    #entries: ReplayEntry[] = [];
    #limit: number;

    constructor(limit: number) {
        this.#limit = limit;
    }

    get size(): number {
        return this.#entries.length;
    }

    /** Takes every forwarded line of the channel and keeps or applies what concerns the buffer. */
    observe(line: string, info: IrcLineInfo): void {
        switch (info.command) {
            case "PRIVMSG":
            case "USERNOTICE":
                if (this.#limit === 0) return;
                if (this.#entries.length >= this.#limit) this.#entries.shift();
                this.#entries.push({
                    line,
                    id: tagValue(line, info, "id"),
                    userId: tagValue(line, info, "user-id"),
                });
                return;
            case "CLEARMSG": {
                const id = tagValue(line, info, "target-msg-id");
                // Without a target it would match every line that came without an id.
                if (id) this.#entries = this.#entries.filter((entry) => entry.id !== id);
                return;
            }
            case "CLEARCHAT": {
                // Without a target the whole chat was cleared.
                const userId = tagValue(line, info, "target-user-id");
                this.#entries = userId
                    ? this.#entries.filter((entry) => entry.userId !== userId)
                    : [];
                return;
            }
        }
    }

    lines(): string[] {
        return this.#entries.map((entry) => withTag(entry.line, "petal-replay=1"));
    }
}

/** Twitch sends the full ROOMSTATE on JOIN and only the changed tag afterwards. */
export function mergeRoomstate(cached: string | undefined, update: string): string {
    if (!cached?.startsWith("@") || !update.startsWith("@")) return update;
    const cachedEnd = cached.indexOf(" ");
    const updateEnd = update.indexOf(" ");
    const tags = new Map<string, string>();
    for (const section of [cached.slice(1, cachedEnd), update.slice(1, updateEnd)]) {
        for (const tag of section.split(";")) {
            const eq = tag.indexOf("=");
            tags.set(eq === -1 ? tag : tag.slice(0, eq), eq === -1 ? "" : tag.slice(eq + 1));
        }
    }
    const merged = [...tags].map(([name, value]) => `${name}=${value}`).join(";");
    return `@${merged}${update.slice(updateEnd)}`;
}
