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
| `pnpm build`     | Production build for Cloudflare Pages into `dist/`  |
| `pnpm typecheck` | Type-check with TypeScript                          |
| `pnpm lint`      | Lint and check formatting with Biome                |
| `pnpm format`    | Apply Biome formatting and safe fixes               |
| `pnpm check`     | `typecheck` + `lint` (run before pushing)           |

## Deployment

The app is built and deployed remotely by Cloudflare Pages:

- Build command: `pnpm build`
- Build output directory: `dist`

Pages are server-rendered on Cloudflare; `/v3` is prerendered to static HTML at build time.
