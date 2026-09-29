# Contributing

Bug reports and pull requests are welcome. This page covers the development workflow and the
rules a change has to follow. For how the code fits together, see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Requirements: Node.js 24 or newer (`.node-version`) and pnpm, at the version pinned in
`package.json` under `packageManager`.

```bash
pnpm install
pnpm dev
```

The dev server runs on plain Node and prints its URL. Open `/` for the start page or
`/v3/chat/<channel>` for the overlay. No Cloudflare tooling is needed or installed.

The first `pnpm dev` or `pnpm build` downloads Clash Display and General Sans from Fontshare into
`public/fonts/fontshare/`. The folder is git-ignored because the fonts' license does not allow
republishing them. If the download fails, the pages fall back to system fonts.

| Script           | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Start the dev server with HMR                         |
| `pnpm build`     | Production build for Cloudflare Workers, in `.output/` |
| `pnpm typecheck` | Type-check with TypeScript                            |
| `pnpm lint`      | Lint and check formatting with Biome                  |
| `pnpm format`    | Apply Biome formatting and safe fixes                 |
| `pnpm test`      | Run the unit tests in `test/`                         |
| `pnpm seo`       | Rewrite `llms.txt`, `llms-full.txt` and `sitemap.xml` in `public/` |
| `pnpm og`        | Render the images of a shared link into `public/`, then `pnpm seo` |
| `pnpm check`     | `typecheck`, `lint` and `test`: run before pushing    |

There is no local preview of the built Worker. Use the dev server while working, and a branch
preview build from Cloudflare to try the real deployment.

## Tests

The tests cover IRC parsing, message tokenizing and emote modifiers, every provider's parsers,
7TV events and paints, the reconnecting sockets, the theme rules (including the pre-paint boot
script), and the bot check (which user agents pass, and which spellings of a chat path it
recognizes). They run offline: WebSockets are replaced by a fake (`FakeWebSocket`) and `fetch`
answers from a table (`stubFetch`), both in `test/helpers.ts`.

When the bot check learns a new pattern, add the user agent to `test/bots.test.ts`, and add a
browser or streaming tool's user agent there too if a change could block one. A false positive
blanks an overlay.

## Rules for changes

- Run `pnpm check` before pushing. CI additionally runs `biome ci` and a production build.
- Code style is set by Biome: four spaces, 100 columns. Commit messages follow
  `type(scope): summary` (`feat`, `fix`, `chore`, `test`).
- **Adding a service, a third-party host or anything stored in the browser changes the privacy
  policy.** Update `src/routes/privacy.tsx` and `src/routes/datenschutz.tsx` in the same change,
  together with the list in [DEPLOYMENT.md](DEPLOYMENT.md#legal-pages).
- Keep fonts, scripts and images self-hosted. The pages set no cookies and run no analytics. The
  only thing stored in the browser is the theme choice.
- Do not write dark styles by hand. Change the light tokens in `src/brand.css`; Dark Reader
  derives the night version from them.
- What the start page says lives in `src/lib/seo/site.ts`. See [SEO.md](SEO.md) before changing it.
- Overlay addresses live in streamers' OBS scenes, so an overlay path is never removed once it
  has shipped.

## CI

`.github/workflows/ci.yml` installs dependencies with the frozen lockfile, then runs typecheck,
`biome ci`, the tests and a build. It runs for pushes and pull requests to `main` on our
self-hosted runners. Pull requests from forks are skipped, because the runners are ours and this
repository is public. Renovate keeps dependencies current.

Cloudflare builds and deploys every push to `main`, whether or not these checks pass. See
[DEPLOYMENT.md](DEPLOYMENT.md#releasing).
