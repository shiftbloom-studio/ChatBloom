import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { debounce } from "../../src/components/setup/debounce";
import { recorder } from "../helpers";

describe("debounce", () => {
    it("runs once, with the latest arguments, after the calls have stopped", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const calls = recorder<[string]>();
        const update = debounce(calls, 300);

        update("p");
        t.mock.timers.tick(200);
        update("pa");
        t.mock.timers.tick(299);
        assert.deepEqual(calls.calls, []);

        t.mock.timers.tick(1);
        assert.deepEqual(calls.calls, [["pa"]]);
    });

    it("runs again for calls that come later", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const calls = recorder<[number]>();
        const update = debounce(calls, 300);

        update(1);
        t.mock.timers.tick(300);
        update(2);
        t.mock.timers.tick(300);
        assert.deepEqual(calls.calls, [[1], [2]]);
    });

    it("drops the waiting call when cancelled", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const calls = recorder<[string]>();
        const update = debounce(calls, 300);

        update("p");
        update.cancel();
        t.mock.timers.tick(1000);
        assert.deepEqual(calls.calls, []);
    });
});
