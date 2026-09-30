# Search engines and language models

The start page is the only page that is meant to be found, and it is written to be quoted. What
it says about Petal lives in one module, `src/lib/seo/site.ts`: title, description, the setup
steps, the feature list and the questions with their answers. Almost everything else is built from
it, so the steps and the questions on the page and what machines read cannot contradict each other:

| Output                             | Built by                                  | Read by                         |
| ---------------------------------- | ----------------------------------------- | ------------------------------- |
| `<title>`, description, canonical address, `robots` meta tag, the link to `llms-full.txt` | `src/components/seo/StartHead.tsx` | Search engines, language models |
| Open Graph and Twitter tags, on the start page and the legal pages | `src/components/seo/SocialTags.tsx` | Link previews |
| Structured data (JSON-LD): the site, the app, its source code, the studio, the questions, the setup steps | `src/lib/seo/structured-data.ts` | Search engines, language models |
| The steps and the questions on the page | `src/components/start/`              | People, and everything above    |
| `public/llms.txt`, `public/llms-full.txt` ([llmstxt.org](https://llmstxt.org)) | `src/lib/seo/files.ts` | Language models and their agents |
| `public/sitemap.xml`               | `src/lib/seo/files.ts`                    | Search engines                  |
| `public/robots.txt`                | Written by hand                           | Search engines and the crawlers of language models |
| `public/og.png`, `public/og-square.png` | `scripts/og.ts`, from `scripts/og.html` | Link previews, search engines   |

After changing `src/lib/seo/site.ts`, set its `updated` date and run `pnpm seo`, which writes the
three files in `public/`. The tests fail while those files are out of date, when the title or the
description no longer fits into a search result, when the structured data says something the page
does not, and when `robots.txt` closes something the start page needs. The feature cards on the page
(`src/components/FeaturesGrid.tsx`) are written by hand and no test compares them with the feature
list, so change both together.

## Link previews

`public/og.png` (1200 × 630) is the image of a shared link. It is the only one the tags name,
because previews show the first image they are given. Discord, X, Slack, LinkedIn, Facebook,
Telegram, WhatsApp and iMessage show it whole; a messenger's small thumbnail is the square in its
middle, and X cuts it to 2:1. So everything that matters sits in the middle 630 pixels, and the
type is large enough to be read at a third of the size. `public/og-square.png` (1200 × 1200) is
for search engines, which pick a shape from the structured data and the sitemap.

After changing `scripts/og.html`, run `pnpm og`. It needs a Chromium browser
(`CHROME=/path/to/browser` names one) and the fonts that `pnpm dev` and `pnpm build` download. It
renders both images, notes their hashes in `src/lib/seo/image-versions.ts` and runs `pnpm seo`.
The hash is part of the image's address (`/og.png?v=…`): platforms keep the image of an address
for weeks, so a changed image has to be a new address to them. The tests fail when an image, its
size in the tags and its address disagree, and when an image is heavier than 300 KB: WhatsApp is
reported to leave out images above that.

What a platform shows for a link can be checked, and its cache renewed, with its own tool:
[Facebook](https://developers.facebook.com/tools/debug/),
[LinkedIn](https://www.linkedin.com/post-inspector/) and
[Telegram](https://t.me/WebpageBot). Discord, Slack and X have none; paste the link into a
message to yourself.

Chat pages have no preview. They answer 403 to the programs that would fetch one.

## Claims

Write only what the overlay does today. Every sentence in that module is a claim that search
engines and language models repeat.

The canonical address is `https://petal.shiftbloom.studio/`. The same deployment also answers on
`chat.shiftbloom.studio`, its earlier hostname; the canonical link tells search engines which of
the two to show.

Verifying the domain with the search engines, and the optional redirect rule on the zone, are
one-time setup steps: see [DEPLOYMENT.md](DEPLOYMENT.md). Bots are refused on the chat pages and
on the relay and gateway endpoints behind them, and nowhere else, by the rules in
[ARCHITECTURE.md](ARCHITECTURE.md#bot-protection).
