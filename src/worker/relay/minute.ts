const SLOT_MS = 5000;
const SLOTS = 12;

/**
 * Counts what happened within the last minute, for thresholds that are looked at far less
 * often than is counted. Counting is one addition into the slot of the present. Slots older
 * than a minute are emptied when somebody counts or asks, so there is no timer, and the
 * minute is as exact as a slot is long: it covers the last 55 to 60 seconds.
 */
export class MinuteCounter {
    #slots = new Uint32Array(SLOTS);
    #total = 0;
    /** The number of the slot that was counted into last: its time divided by its length. */
    #newest = 0;

    add(now: number): void {
        this.#expire(now);
        this.#slots[this.#newest % SLOTS]++;
        this.#total++;
    }

    total(now: number): number {
        this.#expire(now);
        return this.#total;
    }

    #expire(now: number): void {
        const slot = Math.floor(now / SLOT_MS);
        // A clock that steps back counts into the slot it had reached.
        if (slot <= this.#newest) return;
        const stale = Math.min(slot - this.#newest, SLOTS);
        for (let step = 1; step <= stale; step++) {
            const index = (this.#newest + step) % SLOTS;
            this.#total -= this.#slots[index] as number;
            this.#slots[index] = 0;
        }
        this.#newest = slot;
    }
}
