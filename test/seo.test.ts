import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { files } from "../src/lib/seo/files";
import { site } from "../src/lib/seo/site";

const published = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url));

// Both are generated and drift silently: nothing on the page shows that they are stale.
describe("generated files in public/", () => {
    // Platforms cache a preview by its address, so a new image needs a new one (`pnpm og`).
    it("give every image of a shared link an address that changes with the image", async () => {
        for (const image of site.images) {
            const file = await published(image.file);
            const version = createHash("sha256").update(file).digest("hex").slice(0, 8);
            assert.equal(image.url, `${site.origin}/${image.file}?v=${version}`, image.file);
        }
    });

    it("hold the files for machines as src/lib/seo writes them (run `pnpm seo`)", async () => {
        for (const [name, content] of Object.entries(files)) {
            assert.equal(String(await published(name)), content(), `public/${name} is out of date`);
        }
    });
});
