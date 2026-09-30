import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const source = await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
// Drops comments, but no marker inside a string. As strict as the build: no trailing commas.
const comments = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const config = JSON.parse(source.replace(comments, (match) => (match[0] === '"' ? match : "")));

it("binds the hub everywhere and leaves to the build and the dashboard what is theirs", () => {
    const hub = { name: "CHAT_HUB", class_name: "ChatHub" };
    assert.deepEqual(config.durable_objects.bindings, [hub]);
    assert.deepEqual(config.migrations[0], { tag: "v1", new_sqlite_classes: ["ChatHub"] });
    // A preview inherits nothing, and without the binding `/api/irc` cannot work there.
    assert.deepEqual(config.previews.durable_objects.bindings, [hub]);
    // Nitro adds the first three, the production domain is attached in the dashboard, Wrangler
    // refuses environments in a generated configuration, and a CPU limit would limit the hubs.
    const owned = ["main", "assets", "compatibility_date", "routes", "route", "env", "limits"];
    for (const key of owned) assert.equal(key in config, false, key);
    // The Worker reads its variables as strings, and the relay is on unless switched off.
    assert.equal(config.vars.RELAY_ENABLED, "true");
    const vars = Object.values({ ...config.vars, ...config.previews.vars });
    assert.ok(vars.every((value) => typeof value === "string"));
});
