// Downloads Clash Display and General Sans from Fontshare into `public/fonts/fontshare/`, so the
// site serves them from its own domain: loading them from Fontshare would send every visitor's IP
// address to a third party. The ITF Free Font License allows self-hosting, but not
// redistributing the files in a public repository, so the folder is git-ignored and filled here
// before `vite dev` and `vite build`. `src/brand.css` declares the faces.
//
// A failed download only warns: the pages then fall back to system fonts, which beats a failed
// deployment. Files already on disk are kept; delete the folder to fetch them again.
import { access, mkdir, writeFile } from "node:fs/promises";

const DIR = new URL("../public/fonts/fontshare/", import.meta.url);

// Must match the @font-face rules in `src/brand.css`.
const FAMILIES: Record<string, number[]> = {
    "clash-display": [400, 600],
    "general-sans": [400, 500, 600],
};

const fileUrl = (family: string, weight: number) => new URL(`${family}-${weight}.woff2`, DIR);

const exists = (url: URL) =>
    access(url).then(
        () => true,
        () => false,
    );

async function fetchOk(url: string): Promise<Response> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response;
}

/** Downloads the missing weights of one family; returns the weights still missing afterwards. */
async function download(family: string, weights: number[]): Promise<number[]> {
    const missing: number[] = [];
    for (const weight of weights) {
        if (!(await exists(fileUrl(family, weight)))) missing.push(weight);
    }
    if (missing.length === 0) return [];

    // One family per request: combined requests only return the first family.
    const cssUrl = `https://api.fontshare.com/v2/css?f[]=${family}@${missing.join(",")}`;
    const css = await (await fetchOk(cssUrl)).text();
    for (const face of css.split("@font-face").slice(1)) {
        const weight = Number(/font-weight:\s*(\d+)/.exec(face)?.[1]);
        const src = /url\('([^']+\.woff2)'\)/.exec(face)?.[1];
        if (!src || /font-style:\s*italic/.test(face) || !missing.includes(weight)) continue;
        const font = await fetchOk(new URL(src, "https://cdn.fontshare.com").href);
        await writeFile(fileUrl(family, weight), new Uint8Array(await font.arrayBuffer()));
        missing.splice(missing.indexOf(weight), 1);
    }
    return missing;
}

try {
    await mkdir(DIR, { recursive: true });
    for (const [family, weights] of Object.entries(FAMILIES)) {
        const missing = await download(family, weights);
        if (missing.length > 0) {
            console.warn(
                `[fontshare] ${family} ${missing.join(", ")} not found in Fontshare's CSS`,
            );
        }
    }
} catch (error) {
    console.warn("[fontshare] download failed, the site falls back to system fonts:", error);
}
