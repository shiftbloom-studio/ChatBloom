# Deployment

ChatBloom runs entirely on Cloudflare, as a Worker with static assets. Nothing is self-hosted, and no Cloudflare tooling is needed on a developer machine: Cloudflare builds and deploys the app from the GitHub repository.

## How it is hosted

| Request                                   | Served by                   | Cost            |
| ----------------------------------------- | --------------------------- | --------------- |
| JS, CSS, fonts, images, `/v3` (setup page), legal pages | Cloudflare's asset layer | Free, unlimited |
| `/v3/chat/:channel` (overlay page)        | The Worker, rendered per request | One Worker request |
| `/` (redirects to `/v3`), unknown paths (404) | The Worker              | One Worker request |
| Chat messages, emotes, badges             | Twitch, 7TV, BetterTTV, FrankerFaceZ, directly from the browser | Never reaches Cloudflare |

An open overlay costs one Worker request when it loads and nothing while it runs, because the chat connection goes from the browser (or OBS) straight to Twitch. 200 simultaneous overlays therefore produce a few thousand Worker requests per day.

## One-time setup

Do all of this in the Cloudflare account that holds the startup credits. Credits cannot be moved between accounts.

### 1. Enable the Workers Paid plan

In the dashboard, open **Workers & Pages > Plans** and choose **Workers Paid** ($5 per month).

The free plan allows 100,000 Worker requests per day and 10 ms of CPU time per request. Rendering an overlay page takes 5 to 8 ms on a developer machine, which is too close to that limit for a page that streamers load during a live stream.

### 2. Connect the repository

1. Open **Workers & Pages > Create > Import a repository** and select `shiftbloom-studio/ChatBloom`.
2. Use these settings:

   | Setting           | Value                                         |
   | ----------------- | --------------------------------------------- |
   | Project name      | `chatbloom` (must match `name` in `wrangler.jsonc`) |
   | Production branch | `main`                                        |
   | Build command     | `pnpm build`                                  |
   | Deploy command    | `npx wrangler@4 deploy`                       |
   | Preview command   | `npx wrangler@4 preview`                      |
   | Build variable    | `PNPM_VERSION` = `12.8.1`                     |

3. Save and deploy.

The Node.js version comes from `.node-version`. Keep `PNPM_VERSION` equal to the `packageManager` version in `package.json`.

### 3. Check the first deployment

The build log ends with the `workers.dev` URL of the Worker. Check these:

| URL                  | Expected                                  |
| -------------------- | ----------------------------------------- |
| `/`                  | Redirects to `/v3`                        |
| `/v3`                | Setup page                                |
| `/v3/chat/<channel>` | Overlay showing live chat of that channel |
| `/no-such-page`      | 404 page                                  |

Then add the overlay URL as a browser source in OBS and confirm that chat appears.

### 4. Attach the production domain

Do this before giving overlay URLs to streamers. They paste the URL into OBS, so changing the hostname later breaks their scenes.

1. In `wrangler.jsonc`, uncomment the `routes` entry for `chat.shiftbloom.studio`.
2. Push to `main`. The deployment creates the DNS record and the certificate.

This requires the `shiftbloom.studio` zone to be in the same Cloudflare account, and no existing DNS record for `chat`.

### 5. Close the workers.dev URL

Once the domain works, set `workers_dev` and `preview_urls` to `false` in `wrangler.jsonc` and push. Production is then only reachable through the domain, where the zone's firewall rules apply.

### 6. Set up cost guardrails

Cloudflare has no spending cap for Workers. These keep a bug or abuse from going unnoticed:

- **Budget alerts.** Under **Manage Account > Billing > Billable Usage**, create alerts at $5, $25 and $100. They are emails sent the day after a threshold is crossed; they do not stop usage.
- **Rate limiting.** On the `shiftbloom.studio` zone, add a rate limiting rule under **Security > WAF** for the hostname `chat.shiftbloom.studio`, for example 200 requests per 10 seconds per IP address. One rule is included in every plan.
- **Bot Fight Mode.** Leave it off. It cannot be excluded for single paths, and OBS cannot answer a challenge page.

### 7. Block bots on the chat routes

Only the start page is meant for bots. `public/robots.txt` says so, and the Worker answers 403 to crawlers, AI scrapers and scripts on chat pages (`src/server/block-bots.ts`). Both go by what a program says about itself, so a script that sends a browser's user agent gets through. A rule on the zone stops more of them, and before a Worker request is billed.

Under **Security > WAF > Custom rules**, create a rule with the action **Block**, never a challenge, and paste this into **Edit expression**:

```txt
(starts_with(lower(http.request.uri.path), "/chat/")
  or starts_with(lower(http.request.uri.path), "/v3/chat/")
  or http.request.uri.path eq "/api/irc"
  or starts_with(http.request.uri.path, "/api/data/"))
and (cf.client.bot
  or http.user_agent eq ""
  or lower(http.user_agent) contains "bot"
  or lower(http.user_agent) contains "crawl"
  or lower(http.user_agent) contains "spider"
  or lower(http.user_agent) contains "curl"
  or lower(http.user_agent) contains "python")
```

The last two paths belong to the chat relay. `cf.client.bot` is Cloudflare's list of known crawlers and is available on every plan. Percent-encoded paths such as `/v3/%63hat/` are not decoded by the rule; the Worker catches those.

## Releasing

| Action                   | Result                                                       |
| ------------------------ | ------------------------------------------------------------ |
| Push to `main`           | Cloudflare builds and deploys to production                  |
| Push to any other branch | Cloudflare builds a preview with its own URL, if preview builds are enabled under **Settings > Build > Branch control** |
| Roll back                | **Workers & Pages > chatbloom > Deployments**, then roll back to an earlier version |

GitHub Actions runs type checks, linting, tests and a build for pushes and pull requests to `main` (`.github/workflows/ci.yml`). Cloudflare deploys `main` whether or not those checks pass, so require the `check` job in the branch protection rules for `main`.

Preview URLs are public.

## Cost and capacity

| Simultaneous overlays | Worker requests per day | Monthly cost |
| --------------------- | ----------------------- | ------------ |
| 200                   | A few thousand          | $5           |
| 2,000                 | Tens of thousands       | $5           |
| 20,000                | Hundreds of thousands   | About $26    |

Workers Paid includes 10 million requests and 30 million CPU milliseconds per month. Beyond that, a million requests cost $0.30.

About the startup credits:

- They expire 12 months after the confirmation email and cannot be extended.
- A payment method must stay on file. Usage after the credits expire is charged to it.
- Domain registration and renewal are never paid from credits.
- Whether the $5 plan fee itself is paid from credits is not documented. Check the first invoice.

## What to leave off

Each of these changes the cost model:

| Setting or feature                           | Effect                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| `cache.enabled` in `wrangler.jsonc` (Workers Cache) | Every request becomes billable, including static files that are otherwise free |
| `assets.run_worker_first`                    | Static files are routed through the Worker and billed      |
| Relaying chat through a Durable Object       | About $4 per channel per month; $825 per month at 200 channels |
| Proxying emote or badge APIs through the Worker | All users share Cloudflare's outgoing IP addresses and hit the providers' rate limits together |

## Configuration

| File                            | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `vite.config.ts`, `nitro` section | Build target, compatibility date, prerendered routes, redirects, response headers |
| `wrangler.jsonc`                | Worker name, hostnames, logging                                |
| `public/.assetsignore`          | Files in the build output that must not be published           |
| `src/server/uncached-errors.ts` | Marks error responses as uncacheable                           |
| `scripts/fontshare.ts`          | Downloads the Fontshare fonts before `dev` and `build`; they are self-hosted and git-ignored |

`pnpm build` writes the Worker to `.output/server` and the static files to `.output/public`. It also merges `wrangler.jsonc` into `.output/server/wrangler.json`, which is the file Wrangler deploys.

Rules for changing the configuration:

- Set response headers in `routeRules` in `vite.config.ts`. They apply to static files and to pages rendered by the Worker. A `public/_headers` file would only apply to static files.
- Change the compatibility date in `vite.config.ts` only. The build copies it into the Wrangler configuration.
- Do not add `main`, `assets` or `compatibility_date` to `wrangler.jsonc`. The build sets them.
- Do not add `env` blocks to `wrangler.jsonc`. Wrangler refuses to deploy a generated configuration that contains environments. Use preview builds for testing.
- The Content Security Policy is deliberately minimal. Emotes and badges load from many third-party hosts, so an allowlist for images or connections would break the overlay whenever a provider is added.

## Legal pages

`/imprint` and `/privacy`, with the German versions `/impressum` and `/datenschutz`, are linked from every page's footer and prerendered. The operator's details live only in `src/components/legal/OperatorAddress.tsx`.

The privacy policy names every service a visitor's browser connects to and every log ChatBloom keeps. Update both language versions in the same change as any of these:

- A new emote, badge or chat provider, or a new third-party host on any page. Fonts, scripts and images for the setup page are self-hosted and must stay that way.
- Relaying chat or provider data through Cloudflare, e.g. a Durable Object or a cached gateway.
- Workers Cache, or different `observability` settings in `wrangler.jsonc`.
- Cookies, local storage or analytics of any kind.

## Troubleshooting

| Symptom                                           | Cause and fix                                              |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Build fails while installing dependencies         | The pnpm version of the build does not match. Set the `PNPM_VERSION` build variable to the version in `package.json`. |
| Deploy fails with "Redirected configurations cannot include environments" | `wrangler.jsonc` contains an `env` block. Remove it. |
| Deploy fails after the `routes` entry was added   | The zone is in another account, or a DNS record for `chat` already exists. |
| Deploy fails because the Worker name does not match | The project name in the dashboard differs from `name` in `wrangler.jsonc`. |
| `/v3` redirects to `/v3/`                         | `prerender.autoSubfolderIndex` was removed from `vite.config.ts`. |

## Deploying from GitHub Actions instead

If Cloudflare's build cannot be used, the same deployment works from GitHub Actions. Disconnect the repository in the Cloudflare dashboard first, so that pushes are not deployed twice.

1. Create an API token under **Manage Account > Account API Tokens** with the permission **Account > Workers Scripts > Edit**. Add **Zone > Workers Routes > Edit** for `shiftbloom.studio` while the `routes` entry is being added or changed.
2. In the GitHub repository, create an environment named `production` that is restricted to the `main` branch. Add the token as the environment secret `CLOUDFLARE_API_TOKEN` and the account ID as the variable `CLOUDFLARE_ACCOUNT_ID`.
3. Add a workflow that runs on pushes to `main`, uses the same setup steps as `.github/workflows/ci.yml`, and ends with:

   ```yaml
   - run: pnpm build
   - run: npx wrangler@4 deploy
     env:
       CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
   ```

Do not run deployments on `pull_request_target`, and do not pass the token to pull requests from forks.
