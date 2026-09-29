# Search engines and language models

The start page is the only page that is meant to be found, and it is written to be quoted. What
it says about Petal lives in one module, `src/lib/seo/site.ts`: title, description, the setup
steps, the feature list and the questions with their answers. Everything else is built from it,
so the visible page and what machines read cannot contradict each other:

| Output                             | Built by                                  | Read by                         |
| ---------------------------------- | ----------------------------------------- | ------------------------------- |
| `<title>`, description, canonical address, Open Graph and Twitter tags | `src/components/seo/StartHead.tsx` | Search engines, link previews |
| Structured data (JSON-LD): the site, the app, its source code, the studio, the questions, the setup steps | `src/lib/seo/structured-data.ts` | Search engines, language models |
| The steps and the questions on the page | `src/components/start/`              | People, and everything above    |
| `public/llms.txt`, `public/llms-full.txt` ([llmstxt.org](https://llmstxt.org)) | `src/lib/seo/files.ts` | Language models and their agents |
| `public/sitemap.xml`               | `src/lib/seo/files.ts`                    | Search engines                  |
| `public/og.png`                    | `scripts/og.html`, rendered by hand       | Link previews                   |

After changing `src/lib/seo/site.ts`, set its `updated` date and run `pnpm seo`, which writes the
three files in `public/`. The tests fail while those files are out of date, when the title or the
description no longer fits into a search result, when the structured data says something the page
does not, and when `robots.txt` closes something the start page needs.

Write only what the overlay does today. Every sentence in that module is a claim that search
engines and language models repeat.

The canonical address is `https://petal.shiftbloom.studio/`. The same deployment also answers on
`chat.shiftbloom.studio`, where overlay links from before the move keep working; the canonical
link tells search engines which of the two to show. `/v3`, the start page's earlier address,
redirects to `/` permanently.

Verifying the domain with the search engines, and the redirect rule on the zone, are one-time
setup steps: see [DEPLOYMENT.md](DEPLOYMENT.md). Bots are kept out of the chat pages, and only
those, by the rules in [ARCHITECTURE.md](ARCHITECTURE.md#bot-protection).
