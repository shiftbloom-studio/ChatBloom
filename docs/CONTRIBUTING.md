# Contributing

Bug reports and pull requests are welcome. Bugs and feature requests are opened as
[issues](https://github.com/shiftbloom-studio/petal/issues/new/choose), and questions and ideas go
to [Discussions](https://github.com/shiftbloom-studio/petal/discussions). A security problem goes
by mail to the address in the [imprint](https://petal.shiftbloom.studio/imprint), not into a public
issue.

This page covers the development workflow and the rules a change has to follow. For how the code
fits together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Requirements: Node.js 24 or newer (`.node-version`) and pnpm, at the version pinned in
`package.json` under `packageManager`.

```bash
pnpm install
pnpm dev
```

The dev server runs on plain Node and prints its URL. Open `/` for the start page or
`/chat/<channel>` for the overlay. No Cloudflare tooling is needed or installed. The relay and the
gateway only exist on Cloudflare: the dev server answers `/api/` with 503, so an overlay in
development uses its direct connections to Twitch and the providers.

The first `pnpm dev` or `pnpm build` downloads Clash Display and General Sans from Fontshare into
`public/fonts/fontshare/`. The folder is git-ignored because the fonts' license does not allow
republishing them. If the download fails, the pages fall back to system fonts.

| Script           | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Start the dev server with HMR                         |
| `pnpm build`     | Production build for Cloudflare Workers, in `.output/` |
| `pnpm typecheck` | Type-check the app and, separately, `src/worker`      |
| `pnpm lint`      | Lint and check formatting with Biome                  |
| `pnpm format`    | Apply Biome formatting and safe fixes                 |
| `pnpm test`      | Run the unit tests in `test/`                         |
| `pnpm seo`       | Rewrite `llms.txt`, `llms-full.txt` and `sitemap.xml` in `public/` |
| `pnpm og`        | Render the images of a shared link into `public/`, then `pnpm seo` |
| `pnpm check`     | `typecheck`, `lint` and `test`: run before pushing    |

There is no local preview of the built Worker. Use the dev server while working, and a branch
preview build from Cloudflare to try the real deployment. The end-to-end suite of the relay and
the smoke test in `scripts/e2e/` are run by hand. The suite (`run.mjs`) needs a Wrangler binary
from outside the project; the smoke test (`smoke-live.mjs`) needs a running Petal, local or
deployed, and no Wrangler. See [DEPLOYMENT.md](DEPLOYMENT.md#testing-the-relay).

## Tests

The tests cover IRC parsing, message tokenizing and emote modifiers, every provider's parsers,
7TV events and paints, the reconnecting sockets, the chat transport and its fallback, the options
of an overlay link, the setup on the start page, the relay and the data gateway (`test/worker/`,
which also reads `wrangler.jsonc`), what the start page says to search engines and language models
(`test/seo.test.ts`, which also reads the files and images in `public/`), the theme rules
(including the pre-paint boot script), and the bot check (which user agents pass,
and which spellings of a chat path it recognizes). They run offline: WebSockets are replaced by a
fake (`FakeWebSocket`) and `fetch` answers from a table (`stubFetch`), both in `test/helpers.ts`.
The tests of the relay and the gateway bring fakes of their own, among them a clock, Twitch and KV,
in `test/worker/relay/fakes.ts` and `test/worker/gateway/fakes.ts`.

To run one test file, load the same loader as `pnpm test` does:
`node --import ./test/register.ts --test test/bots.test.ts`.

When the bot check learns a new pattern, add the user agent to `test/bots.test.ts`, and add a
browser or streaming tool's user agent there too if a change could block one. A false positive
blanks an overlay.

## Rules for changes

- Run `pnpm check` before pushing. CI additionally runs `biome ci` and a production build.
- Code style is set by Biome: four spaces (two in JSON files), 100 columns. Commit messages follow
  `type(scope): summary` (`feat`, `fix`, `docs`, `chore`, `test`).
- **Adding a service, a third-party host or anything stored in the browser changes the privacy
  policy.** So does a change to what the relay holds, what the gateway caches or what is counted
  or logged. Update `src/routes/privacy.tsx` and `src/routes/datenschutz.tsx` in the same change,
  and the list of services they show in `src/components/legal/OverlayServices.tsx`. The cases are
  listed in [DEPLOYMENT.md](DEPLOYMENT.md#legal-pages).
- Keep fonts, scripts and images self-hosted. The pages set no cookies and run no analytics of
  visitors. The only thing stored in the browser is the theme choice.
- Chat messages and the names of chat users never go into a log, a counter, KV or the storage of
  the Durable Object.
- Do not write dark styles by hand. Change the light tokens in `src/brand.css`; Dark Reader
  derives the night version from them.
- `src/worker` runs in the Workers runtime and is type-checked on its own, against that runtime's
  types and without the DOM library. Code outside it must not import from it.
- What the start page says lives in `src/lib/seo/site.ts`. See [SEO.md](SEO.md) before changing it.
- Overlay addresses live in streamers' OBS scenes. The overlay stays at `/chat/<channel>`, and an
  option of the link is never removed or given another meaning once it has shipped.

## CI

`.github/workflows/ci.yml` installs dependencies with the frozen lockfile, then runs typecheck,
`biome ci`, the tests and a build. It runs for pushes and pull requests to `main`, and on demand,
on our self-hosted runners. Pull requests from forks are skipped, because the runners are ours and
this repository is public. Renovate keeps dependencies current.

Cloudflare builds and deploys every push to `main`, whether or not these checks pass. See
[DEPLOYMENT.md](DEPLOYMENT.md#releasing).
