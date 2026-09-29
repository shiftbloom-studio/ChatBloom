import type { Emote } from "./types";

/** A mutable set of emotes, keyed by id for live updates and by name for tokenizing. */
export class EmoteSet {
    readonly #byId = new Map<string, Emote>();
    #byName: Map<string, Emote> | undefined;

    constructor(emotes: Iterable<Emote> = []) {
        for (const emote of emotes) this.#byId.set(emote.id, emote);
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
}
