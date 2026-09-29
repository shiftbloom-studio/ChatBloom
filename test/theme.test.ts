import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
    bootScript,
    nextPreference,
    overlayPath,
    parsePreference,
    resolveTheme,
    storageKey,
    themeColor,
} from "../src/lib/theme/mode";

describe("parsePreference", () => {
    it("keeps only the two explicit choices", () => {
        assert.equal(parsePreference("light"), "light");
        assert.equal(parsePreference("dark"), "dark");
    });

    it("falls back to the device setting for anything else", () => {
        for (const value of [null, undefined, "", "system", "DARK", "sepia", 1]) {
            assert.equal(parsePreference(value), "system");
        }
    });
});

describe("resolveTheme", () => {
    it("follows the device only when asked to", () => {
        assert.equal(resolveTheme("system", true), "dark");
        assert.equal(resolveTheme("system", false), "light");
    });

    it("lets an explicit choice win over the device", () => {
        assert.equal(resolveTheme("light", true), "light");
        assert.equal(resolveTheme("dark", false), "dark");
    });
});

describe("nextPreference", () => {
    it("cycles device, light, dark and back", () => {
        assert.equal(nextPreference("system"), "light");
        assert.equal(nextPreference("light"), "dark");
        assert.equal(nextPreference("dark"), "system");
    });
});

describe("overlayPath", () => {
    it("matches the OBS overlay, in any case", () => {
        for (const path of ["/chat/zackrawrr", "/Chat/zackrawrr", "/CHAT/zackrawrr", "/chat"]) {
            assert.equal(overlayPath.test(path), true, path);
        }
    });

    it("leaves every themed page alone", () => {
        for (const path of ["/", "/setup", "/privacy", "/chatty", "/chatter/x", "/x/chat/y"]) {
            assert.equal(overlayPath.test(path), false, path);
        }
    });
});

type BootOptions = {
    path?: string;
    stored?: string | null;
    osDark?: boolean;
    storageThrows?: boolean;
    noMatchMedia?: boolean;
};

/** Runs the pre-paint script against a minimal page and returns what it left behind. */
function boot({
    path = "/",
    stored = null,
    osDark = false,
    storageThrows = false,
    noMatchMedia = false,
}: BootOptions = {}) {
    const dataset: Record<string, string> = {};
    const metas = [{ content: "" }, { content: "" }];
    const timers: (() => void)[] = [];
    runInNewContext(bootScript, {
        document: {
            documentElement: { dataset },
            querySelectorAll: (selector: string) =>
                selector === 'meta[name="theme-color"]' ? metas : [],
        },
        location: { pathname: path },
        localStorage: {
            getItem(key: string) {
                if (storageThrows) throw new Error("blocked");
                assert.equal(key, storageKey);
                return stored;
            },
        },
        matchMedia: noMatchMedia
            ? undefined
            : (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && osDark }),
        setTimeout: (callback: () => void) => timers.push(callback),
    });
    return { dataset, metas, timers };
}

describe("bootScript", () => {
    it("starts dark visitors on Ink, waiting for Dark Reader", () => {
        const { dataset, metas } = boot({ osDark: true });
        assert.equal(dataset.theme, "dark");
        assert.equal("themePending" in dataset, true);
        assert.deepEqual(
            metas.map((meta) => meta.content),
            [themeColor.dark, themeColor.dark],
        );
    });

    it("starts light visitors on paper, with nothing to wait for", () => {
        const { dataset, metas } = boot({ osDark: false });
        assert.equal(dataset.theme, "light");
        assert.equal("themePending" in dataset, false);
        assert.equal(metas[0].content, themeColor.light);
    });

    it("lets a stored choice win over the device, both ways", () => {
        assert.equal(boot({ stored: "light", osDark: true }).dataset.theme, "light");
        assert.equal(boot({ stored: "dark", osDark: false }).dataset.theme, "dark");
    });

    it("ignores a stored value it does not know", () => {
        assert.equal(boot({ stored: "sepia", osDark: true }).dataset.theme, "dark");
    });

    it("follows the device when storage is blocked", () => {
        assert.equal(boot({ storageThrows: true, osDark: true }).dataset.theme, "dark");
    });

    it("gives up waiting after a while, in case the bundle never arrives", () => {
        const { dataset, timers } = boot({ osDark: true });
        assert.equal(timers.length, 1);
        timers[0]();
        assert.equal("themePending" in dataset, false);
    });

    it("never touches the OBS overlay", () => {
        const { dataset, metas, timers } = boot({ path: "/chat/zackrawrr", stored: "dark" });
        assert.deepEqual(dataset, {});
        assert.equal(metas[0].content, "");
        assert.equal(timers.length, 0);
    });

    it("never throws, so it cannot take the page down", () => {
        assert.doesNotThrow(() => boot({ noMatchMedia: true }));
    });
});
