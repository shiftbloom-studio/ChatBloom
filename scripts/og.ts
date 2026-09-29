// Renders the images of a shared link: scripts/og.html, in every format that
// src/lib/seo/site.ts lists, into `public/`. Needs a Chromium browser (Chrome, Chromium, Edge or
// Brave; `CHROME=/path/to/browser pnpm og` names another) and the fonts that `pnpm dev` and
// `pnpm build` download.
//
// Afterwards it notes the hash of every file in src/lib/seo/image-versions.ts. The hash is part
// of the image's address, and `pnpm test` fails while the two disagree.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { site } from "../src/lib/seo/site";

const run = promisify(execFile);

const installed: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ],
    win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
};
const commands = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

function browser(): string {
    const onPath = (process.env.PATH ?? "")
        .split(delimiter)
        .flatMap((directory) => commands.map((command) => join(directory, command)));
    const found = [process.env.CHROME, ...(installed[process.platform] ?? []), ...onPath].find(
        (path) => path && existsSync(path),
    );
    if (!found) throw new Error("No Chromium browser found. Name one with CHROME=/path/to/it.");
    return found;
}

const template = new URL("og.html", import.meta.url);
const fonts = new URL("../public/fonts/fontshare/clash-display-600.woff2", import.meta.url);
if (!existsSync(fonts)) throw new Error("The fonts are missing. Run `node scripts/fontshare.ts`.");

const chrome = browser();
const versions: [file: string, version: string][] = [];

for (const image of site.images) {
    const target = new URL(`../public/${image.file}`, import.meta.url);
    // Without a profile of its own: a headless browser then uses one that it throws away, and
    // it quits after the screenshot, which it does not do with `--user-data-dir`.
    await run(
        chrome,
        [
            "--headless=new",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            `--window-size=${image.width},${image.height}`,
            // The page loads its fonts from `public/`, and gets the time to do so.
            "--allow-file-access-from-files",
            "--virtual-time-budget=3000",
            `--screenshot=${fileURLToPath(target)}`,
            `${template.href}?format=${image.format}`,
        ],
        { timeout: 60_000 },
    );

    const file = await readFile(target);
    // A PNG carries its width and height right after its signature, in the IHDR chunk.
    const [width, height] = [file.readUInt32BE(16), file.readUInt32BE(20)];
    if (width !== image.width || height !== image.height) {
        throw new Error(`${image.file} is ${width} × ${height}, not as site.ts says`);
    }
    versions.push([image.file, createHash("sha256").update(file).digest("hex").slice(0, 8)]);
    console.log(`public/${image.file}  ${width} × ${height}  ${file.byteLength} bytes`);
}

await writeFile(
    new URL("../src/lib/seo/image-versions.ts", import.meta.url),
    `// Written by \`pnpm og\` (scripts/og.ts), not by hand.
//
// The first characters of the SHA-256 of every image of a shared link. They are part of the
// image's address: platforms keep the image of an address for weeks, so a changed image has to
// be a new address to them.
export const versions = {
${versions.map(([file, version]) => `    "${file}": "${version}",`).join("\n")}
} as const;
`,
);
console.log("src/lib/seo/image-versions.ts");
