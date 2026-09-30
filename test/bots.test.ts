import assert from "node:assert/strict";
import { it } from "node:test";

import { isAutomated } from "../src/server/bots";

// A false positive blanks an overlay; scripts and crawlers are refused in test/worker/api.test.ts.
it("lets browsers through, including the ones inside streaming software", () => {
    for (const agent of [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.120 Safari/537.36 OBS/31.0.3",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    ]) {
        assert.equal(isAutomated(agent), false, agent);
    }
});
