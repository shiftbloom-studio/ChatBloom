# ChatBloom

A Twitch chat overlay for streamers, built with [SolidStart](https://docs.solidjs.com/solid-start) and [SUID](https://suid.dev) (Material UI for Solid).

## Requirements

- Node.js 24+ (see `.node-version`)
- pnpm (the version is pinned in `package.json` → `packageManager`)

## Development

```bash
pnpm install
pnpm dev
```

The dev server runs on plain Node; no local Cloudflare tooling is needed.

| Script           | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Start the dev server with HMR                       |
| `pnpm build`     | Production build for Cloudflare Workers, `.output/` |
| `pnpm typecheck` | Type-check with TypeScript                          |
| `pnpm lint`      | Lint and check formatting with Biome                |
| `pnpm format`    | Apply Biome formatting and safe fixes               |
| `pnpm test`      | Run unit tests (`test/`) with Node's test runner    |
| `pnpm check`     | `typecheck` + `lint` + `test` (run before pushing)  |

## Deployment

The app runs on Cloudflare Workers. Cloudflare builds and deploys it from this repository on every push to `main`:

- Build command: `pnpm build`
- Deploy command: `npx wrangler@4 deploy`

Static files and the prerendered `/v3` page are served by Cloudflare directly. The Worker renders the overlay pages.

Setup, costs and operations are described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Chat overlay

Add `https://<your-deployment>/v3/chat/<channel>` as an OBS browser source. The page is
transparent and connects straight from the browser to Twitch chat (anonymously) and to 7TV,
BetterTTV and FrankerFaceZ for emotes, badges, name paints and live updates; no server-side
state or secrets are involved.

## CI

`.github/workflows/ci.yml` runs install, typecheck, lint, test and build on the self-hosted
runners for pushes and pull requests to `main`. Pull requests from forks are skipped, since the
runners are ours and this repository is public.
