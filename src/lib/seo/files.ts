// The files in `public/` that are written for machines: `llms.txt` and `llms-full.txt` for
// language models (https://llmstxt.org) and `sitemap.xml` for search engines. `scripts/seo.ts`
// writes them, and `test/seo.test.ts` fails when they no longer match this module.

import { features, origins, questions, site, steps, studio } from "./site";

const overlay = `${site.origin}${site.overlayPath}<channel>`;

const facts = [
    `Address: ${site.url}`,
    "Price: free. No account, no Twitch login, no ads, no cookies, no analytics.",
    `Overlay link: \`${overlay}\`, made on the start page from a channel name.`,
    "Used as: a browser source in OBS Studio, Streamlabs Desktop or any streaming software that can show a web page. The page is transparent.",
    "Emotes: Twitch, 7TV, BetterTTV (BTTV), FrankerFaceZ (FFZ). Badges: the same, plus FFZ:AP and Chatterino. Name paints: 7TV.",
    `License: ${site.license.name} (${site.license.spdx}).`,
    `Made by: ${studio.name} (${studio.url}). Forked from ${origins.name} by ${origins.author}.`,
    "Not affiliated with or endorsed by Twitch, 7TV, BetterTTV, FrankerFaceZ or Chatterino.",
    "Overlay pages show the chat of a channel and are not for crawlers: automated clients get a 403 there. Read this file or the start page instead.",
];

const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n");

/** The index: what Petal is, and where to read more. */
export function llmsTxt(): string {
    return `# ${site.name}

> ${site.summary}

${list(facts)}

## Petal

- [Start page](${site.url}): Makes the overlay link from a channel name. Explains the setup, the features and the common questions.
- [Petal on one page](${site.origin}/llms-full.txt): The setup steps, every feature and every question with its answer, as Markdown.

## Source code

- [Repository](${site.repository}): The source code, in TypeScript, on SolidStart and Cloudflare Workers.
- [README](${site.readme}): What Petal does, how to set it up and how to run it locally.
- [Architecture](https://raw.githubusercontent.com/shiftbloom-studio/petal/main/docs/ARCHITECTURE.md): How the overlay works, which services it talks to and the project layout.
- [Deployment](https://raw.githubusercontent.com/shiftbloom-studio/petal/main/docs/DEPLOYMENT.md): How Petal is hosted on Cloudflare, what it costs and how to run your own copy.

## Optional

- [${origins.name}](${origins.repository}): The project Petal was forked from, by ${origins.author}.
- [${studio.name}](${studio.url}): The studio that makes and hosts Petal.
`;
}

/** Everything the start page says, in one Markdown file. */
export function llmsFullTxt(): string {
    const setup = steps
        .map((step, index) => `${index + 1}. **${step.title}** ${step.text}`)
        .join("\n");
    const answers = questions
        .map((entry) => {
            // Links into the site lead to pages that robots.txt closes to crawlers.
            const more =
                entry.link && !entry.link.href.startsWith("/")
                    ? ` See [${entry.link.label}](${entry.link.href}).`
                    : "";
            return `### ${entry.question}\n\n${entry.answer}${more}`;
        })
        .join("\n\n");

    return `# ${site.name}

> ${site.summary}

${list(facts)}

## How to add Twitch chat to OBS with Petal

${setup}

## Features

${list(features)}

## Questions and answers

${answers}

## Source code

Petal is free software under the ${site.license.name}. The source code is at ${site.repository}.

Last updated: ${site.updated}
`;
}

/** One address: the start page is the only page that is meant to be found. */
export function sitemapXml(): string {
    const images = site.images
        .map(
            (image) => `    <image:image>
      <image:loc>${image.url}</image:loc>
    </image:image>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${site.url}</loc>
    <lastmod>${site.updated}</lastmod>
${images}
  </url>
</urlset>
`;
}

/** File name in `public/` and what belongs in it. */
export const files: Record<string, () => string> = {
    "llms.txt": llmsTxt,
    "llms-full.txt": llmsFullTxt,
    "sitemap.xml": sitemapXml,
};
