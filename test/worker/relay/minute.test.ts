import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MinuteCounter } from "../../../src/worker/relay/minute";

const SECOND = 1000;
/** A time of day as the runtime reports it, at the start of a slot. */
const START = 1_790_000_000_000;

describe("MinuteCounter", () => {
    it("counts what happened within the last minute", () => {
        const counter = new MinuteCounter();
        assert.equal(counter.total(START), 0);
        for (let second = 0; second < 50; second++) counter.add(START + second * SECOND);
        assert.equal(counter.total(START + 50 * SECOND), 50);
        assert.equal(counter.total(START + 59 * SECOND), 50);
    });

    it("forgets slot by slot what is older than a minute", () => {
        const counter = new MinuteCounter();
        for (let second = 0; second < 120; second++) counter.add(START + second * SECOND);
        // The slot of the present is empty still, the eleven before it hold five each.
        assert.equal(counter.total(START + 120 * SECOND), 55);
        assert.equal(counter.total(START + 124 * SECOND), 55);
        assert.equal(counter.total(START + 125 * SECOND), 50);
        assert.equal(counter.total(START + 174 * SECOND), 5);
        assert.equal(counter.total(START + 175 * SECOND), 0);
    });

    it("is empty after a silence of any length", () => {
        const counter = new MinuteCounter();
        for (let index = 0; index < 1000; index++) counter.add(START);
        assert.equal(counter.total(START + 4 * SECOND), 1000);
        assert.equal(counter.total(START + 3600 * SECOND), 0);
        counter.add(START + 3600 * SECOND);
        assert.equal(counter.total(START + 3601 * SECOND), 1);
    });

    it("keeps counting when the clock steps back", () => {
        const counter = new MinuteCounter();
        counter.add(START + 30 * SECOND);
        counter.add(START);
        assert.equal(counter.total(START + 30 * SECOND), 2);
        assert.equal(counter.total(START + 90 * SECOND), 0);
    });
});
