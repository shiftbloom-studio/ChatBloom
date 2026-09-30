import type { Emote } from "./types";

/** A mutable set of emotes, keyed by id for live updates and by name for tokenizing. */
export class EmoteSet {
    readonly #byId = new Map<string, Emote>();
    #byName: Map<string, Emote> | undefined;
    /** The provider's list as the last {@link sync} had it: each emote as JSON, by id. */
    #listed = new Map<string, string>();

    constructor(emotes: Iterable<Emote> = []) {
        this.sync(emotes);
    }

    get size(): number {
        return this.#byId.size;
    }

    get(name: string): Emote | undefined {
        if (!this.#byName) {
            this.#byName = new Map();
            for (const emote of this.#byId.values()) {
                // The first emote to claim a name wins, like on Twitch.
                if (!this.#byName.has(emote.name)) this.#byName.set(emote.name, emote);
            }
        }
        return this.#byName.get(name);
    }

    getById(id: string): Emote | undefined {
        return this.#byId.get(id);
    }

    add(emote: Emote): void {
        this.#byId.set(emote.id, emote);
        this.#byName = undefined;
    }

    remove(id: string): Emote | undefined {
        const emote = this.#byId.get(id);
        if (emote) {
            this.#byId.delete(id);
            this.#byName = undefined;
        }
        return emote;
    }

    rename(id: string, name: string): void {
        const emote = this.#byId.get(id);
        if (emote) this.add({ ...emote, name });
    }

    /**
     * Takes a newer copy of the provider's list and applies what it has news of: whatever
     * differs from the copy before it, removals included. An emote on which both copies agree
     * stays as it is, and so does one the socket added that neither copy has: the provider's
     * socket may have edited it in between, and a copy can come from a cache and be minutes
     * older than the socket's latest edit, which it must not undo. Returns whether the set
     * changed.
     */
    sync(emotes: Iterable<Emote>): boolean {
        const listed = new Map<string, string>();
        let changed = false;
        for (const emote of emotes) {
            const json = JSON.stringify(emote);
            listed.set(emote.id, json);
            if (this.#listed.get(emote.id) === json) continue;
            const current = this.#byId.get(emote.id);
            if (current && JSON.stringify(current) === json) continue;
            this.add(emote);
            changed = true;
        }
        for (const id of this.#listed.keys()) {
            if (!listed.has(id) && this.remove(id)) changed = true;
        }
        this.#listed = listed;
        return changed;
    }
}
