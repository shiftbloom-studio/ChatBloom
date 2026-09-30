import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { HUB_DEFAULTS } from "../../src/worker/relay/core";

interface HubBinding {
    name: string;
    class_name: string;
}

interface WranglerConfig {
    [key: string]: unknown;
    durable_objects: { bindings: HubBinding[] };
    migrations: { tag: string; new_sqlite_classes?: string[] }[];
    vars: Record<string, unknown>;
    previews: { durable_objects: { bindings: HubBinding[] }; vars: Record<string, unknown> };
}

/** Removes the comments; a comment marker inside a string stays what it is. */
function withoutComments(source: string): string {
    return source.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) =>
        match.startsWith('"') ? match : "",
    );
}

const source = await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
// `JSON.parse` is as strict as the build: it refuses a comma after the last entry.
const config = JSON.parse(withoutComments(source)) as WranglerConfig;

describe("wrangler.jsonc", () => {
    it("leaves to the build and to the dashboard what belongs to them", () => {
        // Nitro adds the first three. The production domain is attached in the dashboard, and
        // Wrangler refuses environments in a generated configuration.
        for (const key of ["main", "assets", "compatibility_date", "routes", "route", "env"]) {
            assert.equal(key in config, false, key);
        }
    });

    it("declares the hub as a class with SQLite storage, created by the first migration", () => {
        const hub = { name: "CHAT_HUB", class_name: "ChatHub" };
        assert.deepEqual(config.durable_objects.bindings, [hub]);
        assert.deepEqual(config.migrations[0], { tag: "v1", new_sqlite_classes: ["ChatHub"] });
        assert.equal("exports" in config, false);
        // A preview inherits nothing, and without the binding `/api/irc` cannot work there.
        assert.deepEqual(config.previews.durable_objects.bindings, [hub]);
    });

    it("sets variables as strings, which is how the Worker reads them", () => {
        for (const vars of [config.vars, config.previews.vars]) {
            for (const [name, value] of Object.entries(vars)) {
                assert.equal(typeof value, "string", name);
            }
        }
        assert.equal(config.vars.RELAY_ENABLED, "true");
    });

    it("names the thresholds of the safety switch, which are those of the code", () => {
        const { vars } = config;
        assert.deepEqual(
            {
                RELAY_PAUSE_CLIENTS: vars.RELAY_PAUSE_CLIENTS,
                RELAY_PAUSE_CHANNELS: vars.RELAY_PAUSE_CHANNELS,
                RELAY_PAUSE_CONNECTS_PER_MINUTE: vars.RELAY_PAUSE_CONNECTS_PER_MINUTE,
                RELAY_PAUSE_LINES_PER_MINUTE: vars.RELAY_PAUSE_LINES_PER_MINUTE,
                RELAY_PAUSE_FRAMES_PER_MINUTE: vars.RELAY_PAUSE_FRAMES_PER_MINUTE,
                RELAY_PAUSE_MINUTES: vars.RELAY_PAUSE_MINUTES,
            },
            {
                RELAY_PAUSE_CLIENTS: String(HUB_DEFAULTS.pauseClients),
                RELAY_PAUSE_CHANNELS: String(HUB_DEFAULTS.pauseChannels),
                RELAY_PAUSE_CONNECTS_PER_MINUTE: String(HUB_DEFAULTS.pauseConnectsPerMinute),
                RELAY_PAUSE_LINES_PER_MINUTE: String(HUB_DEFAULTS.pauseLinesPerMinute),
                RELAY_PAUSE_FRAMES_PER_MINUTE: String(HUB_DEFAULTS.pauseFramesPerMinute),
                RELAY_PAUSE_MINUTES: String(HUB_DEFAULTS.pauseMs / 60_000),
            },
        );
        // Every deployment makes all overlays connect again within seconds.
        assert.ok(Number(vars.RELAY_PAUSE_CONNECTS_PER_MINUTE) > Number(vars.RELAY_PAUSE_CLIENTS));
        assert.ok(
            Number(vars.RELAY_PAUSE_FRAMES_PER_MINUTE) > 3 * Number(vars.RELAY_PAUSE_CLIENTS),
        );
        // A preview runs on the defaults.
        const preview = Object.keys(config.previews.vars);
        assert.deepEqual(
            preview.filter((name) => name.startsWith("RELAY_PAUSE_")),
            [],
        );
    });

    it("does not limit the CPU time, which would limit the hubs", () => {
        assert.equal("limits" in config, false);
    });
});
