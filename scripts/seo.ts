// Writes the files in `public/` that are made for machines (`llms.txt`, `llms-full.txt`,
// `sitemap.xml`) from src/lib/seo. Run `pnpm seo` after changing what Petal says about itself;
// `pnpm test` fails while the files are out of date.
import { writeFile } from "node:fs/promises";

import { files } from "../src/lib/seo/files";

for (const [name, content] of Object.entries(files)) {
    await writeFile(new URL(`../public/${name}`, import.meta.url), content());
    console.log(`public/${name}`);
}
