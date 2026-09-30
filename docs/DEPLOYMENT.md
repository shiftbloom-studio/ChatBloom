# Deployment

Petal runs entirely on Cloudflare, as one Worker with static assets, a Durable Object class and a KV namespace. Nothing is self-hosted, and no Cloudflare tooling is needed on a developer machine: GitHub Actions builds the app and deploys it with Wrangler on every push to `main`.

How the relay and the data gateway work is described in [ARCHITECTURE.md](ARCHITECTURE.md).

The Worker and everything that belongs to it carry the product's name: the Worker `petal`, the KV namespace `petal-cache`, the dataset `petal_relay`, the keep-alive `PING :petal`, the header `x-petal-cache` and the tag `petal-replay`. Do not rename the Worker: a renamed Worker is a new Worker, without the domains, the hubs and the cache of this one.

## How it is hosted

| Request                                   | Served by                   | Cost            |
| ----------------------------------------- | --------------------------- | --------------- |
| JS, CSS, fonts, images, `/` (start page), legal pages, `robots.txt`, `sitemap.xml`, `llms.txt` | Cloudflare's asset layer | Free, unlimited |
| `/chat/:channel` (overlay page)           | The Worker, rendered per request | One Worker request |
| `/setup` (redirects to `/#setup`), unknown paths (404) | The Worker     | One Worker request |
| `/api/irc` (chat of one channel, WebSocket) | The Worker passes the connection to a `ChatHub` Durable Object, which reads the channel from Twitch | One Worker request and one Durable Object request per connection, plus the time the hub spends in memory |
| `/api/data/...` (lists of emotes, badges and name paints) | The Worker's data gateway: from memory or KV, otherwise from the provider | One Worker request, usually one KV read, one KV write per refresh |
| `/api/status` (health)                    | The Worker, which asks every hub | One Worker request and one Durable Object request per hub |
| Emote and badge images, live updates of 7TV, BetterTTV and FrankerFaceZ | The providers, directly from the browser | Never reaches Cloudflare |

An overlay that loads costs one Worker request for the page, one for the chat connection and about a dozen for provider data. While it runs, a chat line costs nothing: messages from a hub to an overlay are not billed, and Cloudflare answers the overlay's keep-alive without running code. What is billed while overlays are connected is the time the hubs spend in memory.

If the relay or the gateway cannot be reached, the overlay connects to Twitch and the providers directly. `?direct=1` on the overlay URL forces this.

### Pages and paths

There is one page for visitors: the start page `/`. Its hero ends in the channel field, and the section `#setup` below it holds the look options, the live preview and the personal link, which reflects the channel and the look. The steps for OBS, the way from nothing to chat on screen in short, the features and the questions follow. `/setup` redirects to `/#setup` with status 302.

The overlay lives at `/chat/<channel>` and nowhere else; every path that is not listed above answers with the 404 page. Links to the overlay are in OBS scenes, so the path and the options of a link keep their meaning. The preview on the start page is the overlay itself in a frame, with `demo=1`: sample messages, and no connection to Twitch or a provider.

### What streamers need

Petal needs OBS 31 or newer. OBS 31 embeds Chromium 127; OBS 30 and older embed an older Chromium that the build does not target, so emote animations stand still there and other things may fail. The code contains no fallback for them.

## One-time setup

Do all of this in the Cloudflare account that holds the startup credits. Credits cannot be moved between accounts.

### 1. Enable the Workers Paid plan

In the dashboard, open **Workers & Pages > Plans** and choose **Workers Paid** ($5 per month).

The free plan does not carry this deployment:

- It allows 100,000 Worker requests per day and 10 ms of CPU time per request. Rendering an overlay page takes 5 to 8 ms on a developer machine, which is too close to that limit for a page that streamers load during a live stream.
- It allows 13,000 GB-s of Durable Object duration per day. One hub that stays in memory uses 11,059 GB-s per day, so one hub fits and the default of four does not. When the allowance is used up, calls to the hubs fail.

### 2. Enable Analytics Engine

Analytics Engine has to be switched on once per account, or every deployment that contains the `ANALYTICS` binding fails with code 10089. In the dashboard, open **Workers & Pages**, find **Analytics Engine** in the side bar of the overview and select **Set up**, then **Enable Analytics Engine**. Depending on the dashboard version the entry is under **Storage & databases > Analytics Engine** instead. The error message of a failed deployment contains the link.

No dataset has to be created. The first data point creates `petal_relay`.

### 3. Let GitHub Actions deploy

The job `deploy` of `.github/workflows/ci.yml` runs on every push to `main` once the checks of the job `check` have passed. It builds the app and runs `npx wrangler@4 deploy`, which deploys the Worker named in `wrangler.jsonc`. The job needs two values from the organization's settings under **Settings > Secrets and variables > Actions**, both restricted to the repository `petal`:

| Name                    | Kind     | Value                                                     |
| ----------------------- | -------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secret   | An API token created under **My Profile > API Tokens** with these permissions and no others: Account > Workers Scripts > Edit, Account > Workers KV Storage > Edit, Account > Account Settings > Read, User > User Details > Read. Account resources: this account only. No zone resources: the domains are attached in the dashboard, not by the deployment |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | The account id, shown in the right column of **Workers & Pages** |

Do not connect the repository under **Workers & Pages > Create application > Import a repository** as well: every push would then be deployed twice. A connection that exists is removed under **Workers & Pages > petal > Settings > Build**.

The Node.js version comes from `.node-version`. The pnpm version is recorded in two places that must agree: `packageManager` in `package.json` and `pnpm-lock.yaml` (run `pnpm install` after changing the version).

### What a deployment creates

Nothing has to be created by hand. The first deployment that contains the bindings creates what they need, and later deployments reuse it:

| Binding                         | Resource                                    | How it comes into being |
| ------------------------------- | ------------------------------------------- | ----------------------- |
| `CHAT_HUB`                      | Durable Object class `ChatHub`, SQLite-backed | Migration `v1` in `wrangler.jsonc`, applied once |
| `CACHE`                         | KV namespace `petal-cache`              | Created by the deployment, because the binding names no `id`. The id is only visible in the dashboard, under **Settings > Bindings** of the Worker |
| `ANALYTICS`                     | Analytics Engine dataset `petal_relay`  | Created by the first data point |
| `RATE_LIMIT`, `RATE_LIMIT_MISS` | 300 and 60 requests per 60 seconds, per client address | Part of the Worker; there is no resource |
| `CF_VERSION_METADATA`           | Id of the running version, for `/api/status` | Part of the Worker      |
| `ASSETS`                        | The static files                            | Added by the build      |

Every binding except `CHAT_HUB` is optional at runtime. Without `CACHE` the gateway works from memory and the providers, without `ANALYTICS` nothing is counted, and without the rate limits nothing is refused.

The deployment that applies migration `v1` is a one-way door: see [No way back across the relay deployment](#no-way-back-across-the-relay-deployment).

### 4. Attach the production domains

The Worker has no address of its own: `wrangler.jsonc` switches its `workers.dev` URL off (see [step 6](#6-keep-the-worker-off-other-hostnames)). It is reachable once the domains are attached. Do this before giving overlay URLs to streamers. They paste the URL into OBS, so changing the hostname later breaks their scenes.

Open **Workers & Pages > petal**, then the **Domains** tab (in older dashboards **Settings > Domains & Routes**), and add `petal.shiftbloom.studio` and `chat.shiftbloom.studio` as custom domains. Where the dialog asks **Enable for**, choose production only. A domain enabled for *Preview* or *Production and Preview* gives every preview a public address below it, such as `<preview>.petal.shiftbloom.studio`, and a preview runs without the Worker's rate limits. Cloudflare creates the DNS records and the certificates. This requires the `shiftbloom.studio` zone to be in the same Cloudflare account.

`petal.shiftbloom.studio` is the address given to streamers. `chat.shiftbloom.studio` is the earlier one and stays attached. The start page writes the hostname it was opened on into the overlay link, so links with either hostname are in OBS scenes. Both serve the same Worker, and an overlay always uses the relay and the gateway of the hostname it was loaded from.

The domains are deliberately not listed in `wrangler.jsonc`. Without a `routes` entry, deployments leave the domains of the dashboard alone. With one, Wrangler would replace them by the list in the file on every deployment, and a deployment of a fork would fail, because the zone is not in its account.

### 5. Check the first deployment

Open `https://petal.shiftbloom.studio` and check these in a browser; command line tools are refused on chat pages, `/api/irc` and `/api/data/`:

| URL                  | Expected                                  |
| -------------------- | ----------------------------------------- |
| `/`                  | Start page with the channel field, the look options and the preview |
| `/setup`             | Redirects to `/#setup`                    |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | Plain text and XML, not the 404 page |
| `/chat/<channel>`    | Overlay showing live chat of that channel |
| `/chat/<channel>?size=3&names=0` | The overlay with large text and without user names |
| `/chat/<channel>?demo=1` | The overlay with sample messages, without a connection |
| `/no-such-page`      | 404 page                                  |
| `/api/status`        | JSON; after the overlay of a channel was opened, one hub reports a client and a joined channel |
| `/api/data/bttv/3/cached/emotes/global` | JSON with the response header `x-petal-cache` |

In the browser's developer tools, the overlay page shows a WebSocket to `/api/irc` that stays open. A WebSocket to `irc-ws.chat.twitch.tv` instead means that the overlay fell back to the direct connection.

Then add the overlay URL as a browser source in OBS and confirm that chat appears.

### 6. Keep the Worker off other hostnames

`wrangler.jsonc` sets `workers_dev` and `preview_urls` to `false`. The Worker then answers on the zone's hostnames only: there is no `petal.<subdomain>.workers.dev`, and previews have no URL, as long as no domain is enabled for them ([step 4](#4-attach-the-production-domains)). This matters because Petal is protected in two places:

- **In the Worker.** The bot check ([step 8](#8-block-bots-on-the-chat-routes)) and the Worker's rate limits ([step 7](#7-set-up-cost-guardrails)) are part of the code and apply on every hostname the Worker answers on.
- **On the zone.** The rate limiting rule and the custom rule against bots only see requests to hostnames of the `shiftbloom.studio` zone. A `workers.dev` URL or a preview URL reaches the Worker around them, and a preview runs without the Worker's rate limits as well.

Every deployment applies both settings, also over a change made in the dashboard. Keep both keys in the file. Without `workers_dev`, Wrangler switches the `workers.dev` URL on again, because the file lists no routes. Without `preview_urls`, it keeps whatever the dashboard says, and switching off `workers.dev` alone leaves preview URLs on. Cloudflare generates no version URLs for a Worker that implements a Durable Object, so single versions have no address either.

The **Domains** tab of the Worker shows both as disabled under **Worker URL**. The build log of a deployment says `No targets deployed for petal`, because the domains are attached in the dashboard and Wrangler only lists what it deployed itself.

### 7. Set up cost guardrails

Cloudflare has no spending cap for Workers. These keep a bug or abuse from going unnoticed:

- **Safety switches of the hubs.** A hub that counts more overlays, channels, connections or chat lines than its thresholds allow pauses itself for 15 minutes and costs nothing meanwhile; see [Safety switches](#safety-switches). They bound what the relay can use, not the invoice.
- **Rate limits of the Worker.** Per client address and minute, the Worker accepts 300 chat connections, 300 gateway requests and 300 status requests, and 60 gateway requests that have to ask a provider because nothing is stored. They are counted per Cloudflare location, so they are a brake, not an exact cap, and a refused request is still a billed Worker request.
- **Budget alerts.** Under **Manage Account > Billing > Billable Usage**, create alerts at $5, $25 and $100. They are emails sent the day after a threshold is crossed; they do not stop usage. Thresholds count usage charges only, not the $5 plan fee. Cloudflare may already have created a default alert at $10.
- **Rate limiting on the zone.** On the `shiftbloom.studio` zone, open **Security > Security rules** and select **Create rule > Rate limiting rules**. Example: 200 requests per 10 seconds per IP address, action Block. This is the only limit that stops requests before they are billed. The Free zone plan includes one rule, fixes the period and the block duration at 10 seconds, and can only match on the URL path, so the rule counts requests to every hostname of the zone, static files included. Matching on the hostnames `petal.shiftbloom.studio` and `chat.shiftbloom.studio` needs the Pro plan or higher.
- **Bot Fight Mode.** Leave it off. It cannot be excluded for single paths, and OBS cannot answer a challenge page.

### 8. Block bots on the chat routes

Only the start page is meant for bots. `public/robots.txt` says so, and the Worker answers 403 to crawlers, AI scrapers and scripts on chat pages (`src/server/block-bots.ts`) and on `/api/irc` and `/api/data/` (`src/worker/api.ts`). The start page and the legal pages answer them, and `/api/status` stays open, because a monitor is a script. Both go by what a program says about itself, so a script that sends a browser's user agent gets through. A rule on the zone stops more of them, and before a Worker request is billed.

Under **Security > WAF > Custom rules**, create a rule with the action **Block**, never a challenge, and paste this into **Edit expression**:

```txt
(starts_with(lower(http.request.uri.path), "/chat/")
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

The first path is that of the chat pages, the other two belong to the chat relay and the data gateway. `/api/status` is left out on purpose. `cf.client.bot` is Cloudflare's list of known crawlers and is available on every plan. Percent-encoded paths such as `/%63hat/` are not decoded by the rule; the Worker catches those.

### 9. Tell search engines where Petal lives

The start page names `https://petal.shiftbloom.studio/` as its canonical address, and
`public/sitemap.xml` lists it. Two steps outside the repository make search engines pick it up
sooner:

- Add `petal.shiftbloom.studio` as a property in [Google Search Console](https://search.google.com/search-console)
  and in [Bing Webmaster Tools](https://www.bing.com/webmasters), and submit
  `https://petal.shiftbloom.studio/sitemap.xml` in both. A DNS record on the `shiftbloom.studio`
  zone verifies the whole domain at once. Bing matters beyond its own results: assistants such
  as ChatGPT and Copilot search through its index.
- Optional: a redirect rule on the zone (**Rules > Redirect Rules**) that sends
  `chat.shiftbloom.studio/`, the start page and nothing else, to
  `https://petal.shiftbloom.studio/` with status 301. Never redirect the overlay paths: those
  links are in OBS scenes and must keep working as they are. Without the rule, the canonical
  link already tells search engines which hostname to show.

After changing what the start page says, see [SEO.md](SEO.md).

### 10. Protect main and the CI runners

`.github/workflows/ci.yml` runs the check `Typecheck, lint, test, build` for every push and every pull request to `main`. Runs of `main` itself, pushes and manual runs, use the organization's self-hosted runners (group `Default`, labels `self-hosted`, `linux`, `x64`). Everything else, pull requests from forks included, runs on GitHub's runners, which cost nothing for a public repository.

The workflow file cannot keep a pull request off the self-hosted runners. GitHub runs a pull request's workflow as the pull request changed it, so a fork can ask for the runners in its copy of `ci.yml`. A condition in the file is no help either: a job skipped by `if:` reports success, and a required check passes with it. These settings on GitHub do the rest:

1. **Approve every outside contributor's run.** In the repository, open **Settings > Actions > General**. Under **Approval for running fork pull request workflows from contributors**, choose **Require approval for all external contributors** and select **Save**. A fork's pull request then runs nothing until someone with write access approves it. Read its changes to `.github/` first: an approved run executes the workflow as the pull request wrote it. The two options for first-time contributors are not enough, because one merged pull request, even a typo fix, ends that status.
2. **Give the runners to this repository only.** In the organization, open **Settings > Actions > Runner groups** and select `Default`. Under **Repository access**, choose **Selected repositories**, select `petal` and then **Save group**. **Allow public repositories** has to stay on, or `main` cannot use the runners either. If the runners move to a group of their own, its name replaces `Default` in `ci.yml`.
3. **Limit the runners to `ci.yml` on `main`.** Only possible if the organization is on GitHub Enterprise Cloud: GitHub offers **Workflow access** for runner groups on no other plan. Under **Workflow access** of the same group, choose **Selected workflows** and enter `shiftbloom-studio/petal/.github/workflows/ci.yml@refs/heads/main`. A pull request runs its workflow from its own ref, so it can no longer reach the runners, approved or not.
4. **Require the check.** In a branch ruleset for `main` (**Settings > Rules > Rulesets**) or a branch protection rule (**Settings > Branches**), select **Require status checks to pass before merging** and add `Typecheck, lint, test, build` with **GitHub Actions** as its source, so that no other app can report it. The job `deploy` only runs after the check has passed on `main`, but the rule keeps a failing pull request from being merged in the first place. The check is required by its name: renaming the job in `ci.yml` without changing the rule leaves every pull request waiting for a check that never comes. A pull request that changes `ci.yml` is checked by its own version of the file, so for such a pull request a passing check proves nothing until the change is read.

Without step 3, a pull request that someone approves can still ask for the self-hosted runners. GitHub recommends self-hosted runners only for private repositories. Keep nothing on the runner machines that a pull request must not read, or keep the runners away from this repository altogether: `runs-on: ubuntu-latest` for `main` as well, and `petal` removed from the group's repository access. Changing `ci.yml` alone is not enough, because a pull request can ask for any runner that the repository may use.

## Releasing

| Action                   | Result                                                       |
| ------------------------ | ------------------------------------------------------------ |
| Push to `main`           | GitHub Actions runs the checks, builds and deploys to production. Every overlay reconnects |
| Push to any other branch | Nothing is deployed. Pull requests to `main` run the checks |
| Roll back                | **Workers & Pages > petal > Deployments**, then roll back to an earlier version. Not possible to a version from before the relay |

GitHub Actions runs type checks, linting, tests and a build for pushes and pull requests to `main` (`.github/workflows/ci.yml`), pull requests from forks included; they run on GitHub's runners, see [Protect main and the CI runners](#10-protect-main-and-the-ci-runners). On a push to `main` the job `deploy` follows once those checks have passed, so a commit that fails them is not deployed. Deployments run one at a time and are never cancelled by a later push.

Preview builds of branches exist only with Cloudflare's own build service, which is not connected. The `previews` block in `wrangler.jsonc` describes what such a preview would need (the `CHAT_HUB` binding, the version metadata and the variables, with one shard) and does nothing until one is. A preview URL would be public and outside the zone's rules, so `preview_urls` is `false`, see [Keep the Worker off other hostnames](#6-keep-the-worker-off-other-hostnames).

## Operations

### Health

`GET /api/status` answers with JSON and never contains channel names, user names or chat content. It reports the running version, whether the relay is enabled, whether a hub has paused itself and, per hub, what the hub counts: overlay connections, channels, channels without overlays, lines held for replay, its limits, its pause and the thresholds of its safety switch, the state and age of each connection to Twitch, and event counters since the hub was last started.

| Reading                                        | Meaning                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `upstream.joined` equals `upstream.wanted`     | Every channel with overlays is being received   |
| `upstream.joined` stays below `upstream.wanted` | Channels wait for their JOIN. Normal for some seconds after a restart, and permanent for channels that do not exist or are suspended |
| `upstream.consecutiveFailures` above 0 and rising | The hub cannot reach Twitch or loses its connections right after login |
| A hub reports no channels and no clients       | Nobody is watching a channel of that hub; it leaves memory and costs nothing |
| `uptimeMs` is small on every hub               | A deployment or Cloudflare restarted the hubs   |
| `available` is `false`                         | The hub did not answer within 3 seconds         |
| `clients` or `channels` reach the numbers under `limits` | The hub is full and refuses further overlays, which use their direct connection. Raise `RELAY_SHARDS` |
| `relayPaused` is `true`                        | A hub has paused itself. Its `pause` names the reason and the milliseconds that remain; see [Safety switches](#safety-switches) |
| The counter `watchdog-rearmed` rises           | The alarm of the hub went missing and chat lines had to set it again. Look for errors under **Observability** of the Worker |

Every call asks every hub, which costs one Durable Object request per hub and brings a hub without overlays into memory for a minute or two. Poll at most once a minute.

### Switching the relay off

`RELAY_ENABLED` is the emergency switch. With the value `false`, `/api/irc` answers 503 at once without touching a hub, and overlays use their direct connection to Twitch. The data gateway keeps working. Hubs without overlays leave memory.

1. For an effect within seconds, open **Workers & Pages > petal > Settings > Variables and Secrets**, change `RELAY_ENABLED` to `false` and select **Deploy**.
2. Set `"RELAY_ENABLED": "false"` in `vars` in `wrangler.jsonc` and push. Without this step the next deployment from `main` sets the variable back to what the file says and switches the relay on again.

To switch the relay on again, set the variable to `true` in both places. An overlay that is on its direct connection stays there until that connection is lost or the page is reloaded.

### Safety switches

Every hub watches its own usage and pauses itself when it exceeds a threshold, so that a bug, an attack or a rush of visitors cannot use up the credits unnoticed. A paused hub behaves like the relay with `RELAY_ENABLED` set to `false`, for that hub only and for a limited time:

- It closes its overlay connections with code 1013, gives up its channels and closes its connections to Twitch. It sets no alarm, leaves memory and costs nothing.
- It refuses new connections with 503 `relay_paused` and a `retry-after` header that names the seconds that remain.
- Its overlays use their direct connection to Twitch, as they do whenever the relay fails. Chat goes on.
- After the pause it takes connections again. Nothing has to be done or deployed. A hub that is flooded again pauses itself again.

| Variable                          | Default  | The hub pauses itself above                          |
| --------------------------------- | -------- | ---------------------------------------------------- |
| `RELAY_PAUSE_CLIENTS`             | `2000`   | Overlays connected at once                           |
| `RELAY_PAUSE_CHANNELS`            | `500`    | Channels joined at once                              |
| `RELAY_PAUSE_CONNECTS_PER_MINUTE` | `3000`   | Connections accepted within the last minute          |
| `RELAY_PAUSE_LINES_PER_MINUTE`    | `300000` | Chat lines received from Twitch within the last minute |
| `RELAY_PAUSE_FRAMES_PER_MINUTE`   | `10000`  | Frames received from overlays within the last minute |
| `RELAY_PAUSE_MINUTES`             | `15`     | Length of the pause, at least `1`                    |

The numbers count per hub. `0` switches a threshold off, and a value that is not a whole number counts as the default. The hub looks at the first three with every connection it accepts, at the lines with every alarm, which is every 30 seconds, and at the frames with every frame. Keep `RELAY_PAUSE_CONNECTS_PER_MINUTE` above `RELAY_PAUSE_CLIENTS` and `RELAY_PAUSE_FRAMES_PER_MINUTE` above three times `RELAY_PAUSE_CLIENTS`: every deployment makes all overlays connect again within seconds, with three frames each, and that wave must not pause the hub. Apart from the thresholds, a connection that sends more than 20 frames is closed. The caps `MAX_CLIENTS_PER_HUB` and `MAX_CHANNELS_PER_HUB` stay in force above the thresholds.

How to see a pause:

- `/api/status` reports `relayPaused: true`. The entry of the hub under `shards` carries `pause` with the `reason` (`clients`, `channels`, `connects` or `lines`) and `remainingMs`, and `thresholds` with the numbers in force. Without a pause, `pause` is `null`.
- The hub writes one line to the log when it pauses itself, `hub paused itself`, with the reason, the shard, what it counted and the threshold. Find it under **Observability** of the Worker.
- Analytics Engine receives one data point when a pause starts (`hub-paused`) and one when it is over (`hub-resumed`). A paused hub has no alarm, so the end is noticed and written with the first request that reaches the hub afterwards.
- The counters of the hub hold `paused-clients`, `paused-channels`, `paused-connects` or `paused-lines`, `refused-paused` and `resumed`, since the hub was last started.

The pause survives a restart of the hub and a deployment: the hub keeps the end of the pause and the reason in its storage and reads them when it starts, never for longer than `RELAY_PAUSE_MINUTES` from that moment. To end a pause, wait. To keep every overlay off the relay for longer, use `RELAY_ENABLED`, which remains the manual switch for the whole relay.

The switches bound what the hubs use. They do not look at the invoice, they do not cover the pages, the gateway or requests that the Worker refuses, and with four hubs they allow four times the numbers above. The budget alerts in the Cloudflare dashboard remain the safety net for everything else; see [Set up cost guardrails](#7-set-up-cost-guardrails).

### No way back across the relay deployment

The deployment that applies migration `v1` creates the Durable Object class. After it:

- Cloudflare refuses to roll back to a version from before the migration.
- A deployment of code that no longer exports `ChatHub` fails (code 10064), so reverting the repository to a commit from before the relay does not deploy either.

Rolling back between versions that both contain the relay works as before. Whatever goes wrong with the relay itself is handled by `RELAY_ENABLED` and a fix in a new deployment. Removing the relay for good needs a deployment that removes the binding and the class and appends a migration with `deleted_classes`.

### Every deployment reconnects all overlays

A deployment restarts every hub. That includes a push to `main` and a change of a variable in the dashboard. All overlay connections close at once, the lines held for replay are lost, and the overlays connect again after a delay of 0.5 to 1.5 seconds, longer after repeated failures. The hubs then join their channels again. One connection to Twitch takes 18 JOINs in 10.5 seconds, so a hub opens further connections instead of letting channels wait.

On a live stream this is a gap of a few seconds, and chat lines sent during the gap are not shown. Avoid deploying while many streams are live. Cloudflare restarts hubs for its own runtime updates as well, with the same effect.

### Changing the number of hubs

`RELAY_SHARDS` in `wrangler.jsonc` sets the number of hubs: 4 by default, 64 at most. A channel belongs to the hub `hash(channel) mod RELAY_SHARDS`, so another number moves most channels to another hub. The change is a deployment: overlays reconnect and arrive at their new hub. Hubs that are no longer addressed part their channels after the grace period and leave memory.

Each hub that stays in memory costs about $4.15 per month beyond the included amount. As a rule of thumb, plan one hub per 500 channels; this number is an assumption about CPU headroom, not a measurement. A hub refuses overlays beyond 5,000 connections or 1,000 channels, and with the default thresholds it pauses itself above 2,000 connections or 500 channels already; see [Safety switches](#safety-switches). Add hubs before the numbers in `/api/status` come near the thresholds.

### Testing the relay

Neither tool is part of `pnpm test`, and neither writes chat text, user names or channel names anywhere: they print counts and timings.

`scripts/e2e/run.mjs` runs the built Worker in local workerd against `scripts/e2e/mock-twitch.mjs`, a stand-in for Twitch that produces failures on demand. It needs a Wrangler binary from outside the project, because the project does not depend on Wrangler, and takes about three and a half minutes, one of which is the shortest pause a hub can take. One scenario asks BetterTTV for its global emotes; `E2E_OFFLINE=1` skips it.

```sh
pnpm build
E2E_WRANGLER=<wrangler binary> E2E_WRANGLER_HOME=<empty directory> \
    E2E_PORT=<port; the two above it are used as well> E2E_PROJECT=<project directory> \
    node scripts/e2e/run.mjs
```

`scripts/e2e/smoke-live.mjs` connects overlays through `/api/irc` of a running Petal to channels that are busy right now and compares some of them with a direct connection to Twitch. Run it after a deployment. It opens anonymous, read-only connections to Twitch from the machine it runs on. Both tools send the user agent of OBS, because the relay refuses clients that name themselves as tools.

```sh
SMOKE_URL=https://petal.shiftbloom.studio SMOKE_CHANNELS_FILE=<file, one channel per line> \
    node scripts/e2e/smoke-live.mjs
```

### Tuning variables

All are optional text variables in `vars`. `wrangler.jsonc` sets the first three and the six of the [safety switches](#safety-switches), which are listed there; the defaults of the others are in the code.

| Variable                    | Default  | Meaning                                                  |
| --------------------------- | -------- | -------------------------------------------------------- |
| `RELAY_ENABLED`             | `true`   | `false` switches the relay off; so do `0`, `off` and `no` |
| `RELAY_SHARDS`              | `4`      | Number of hubs                                           |
| `TWITCH_IRC_URL`            | `wss://irc-ws.chat.twitch.tv:443` | Where the hubs connect to; tests point it at a mock server |
| `MAX_CHANNELS_PER_UPSTREAM` | `50`     | Channels per connection to Twitch                        |
| `MAX_CLIENTS_PER_HUB`       | `5000`   | Overlay connections a hub takes before it refuses        |
| `MAX_CHANNELS_PER_HUB`      | `1000`   | Channels a hub takes before it refuses                   |
| `REPLAY_LINES`              | `50`     | Chat lines per channel held in memory for overlays that join late; `0` switches the replay off. The privacy policy names this number |
| `PART_GRACE_MS`             | `60000`  | How long a channel stays joined after its last overlay left |
| `WATCHDOG_MS`               | `30000`  | Interval of the hub's alarm, at least `1000`. Must stay well below 70 seconds, or Cloudflare removes a quiet hub from memory |

## Cost and capacity

These are estimates from a cost model, not measurements. They assume one channel per overlay, 10 page loads per overlay and day, 10 refreshes of a channel's cached data per day, overlays connected around the clock, and a status request once a minute.

| Simultaneous overlays | Hubs | Monthly cost                 | Largest items                     |
| --------------------- | ---- | ---------------------------- | --------------------------------- |
| 200                   | 1    | $5                           | The plan fee                      |
| 200                   | 4    | About $17.50                 | Plan fee $5, hub duration $12.50  |
| 2,000                 | 8    | About $46 to $80             | Hub duration, KV writes           |
| 20,000                | 40   | About $420 to $740           | KV writes, hub duration, log events |

The lower figure for 2,000 overlays assumes that overlays are connected 8 hours a day. The lower figure for 20,000 overlays assumes logs sampled at 10%, traces at 1% and 4 refreshes of a channel's cached data per day.

What the cost consists of:

- **Hub duration.** A hub is billed for the time it is in memory, at a fixed 128 MB: 331,776 GB-s for a whole month. Workers Paid includes 400,000 GB-s, then a million GB-s cost $12.50, and billable usage is rounded up to the next million. One hub therefore costs nothing extra, two to four hubs cost $12.50, and every three further hubs another $12.50. A hub without overlays leaves memory and is not billed.
- **KV.** 10 million reads and 1 million writes per month are included, then a million reads cost $0.50 and a million writes $5.00. Every answer that the gateway fetches from a provider is one write. Writes are the largest item at scale.
- **Log events.** Every Worker request and every hub event (connection, message from an overlay, close, alarm) writes one log event. 20 million per month are included, then a million cost $0.60. Four hubs with overlays produce about 350,000 alarm events per month. Trace spans count as log events from 1 October 2026. To lower the cost, reduce `observability.logs.head_sampling_rate` in `wrangler.jsonc`; at about 2,000 overlays the included events are used up.
- **Requests and CPU time.** Workers Paid includes 10 million Worker requests, 30 million CPU milliseconds and 1 million Durable Object requests per month. Beyond that, a million Worker requests cost $0.30, a million CPU milliseconds $0.02 and a million Durable Object requests $0.15. Messages from an overlay to a hub count as one twentieth of a request.
- **Analytics Engine.** 10 million data points per month are included; Cloudflare does not bill the product yet.

Not documented by Cloudflare, and therefore open: whether the chat lines a hub receives from Twitch count as Durable Object requests. If they do, the figure for 200 overlays rises by about $0.90 per month.

About the startup credits:

- They expire 12 months after the confirmation email and cannot be extended.
- A payment method must stay on file. Usage after the credits expire is charged to it.
- Domain registration and renewal are never paid from credits.
- Whether the $5 plan fee itself is paid from credits is not documented. Check the first invoice.

## What to leave off

Each of these changes the cost model or breaks a promise of the privacy policy:

| Setting or feature                           | Effect                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| `cache.enabled` in `wrangler.jsonc` (Workers Cache) | Every request becomes billable, including static files that are otherwise free |
| `assets.run_worker_first`                    | Static files are routed through the Worker and billed      |
| One Durable Object per channel               | About $4.15 per channel per month; $825 per month at 200 channels, against $12.50 for four shared hubs |
| A gateway route without a cache policy, or a gateway that forwards any URL | All overlays share Cloudflare's outgoing IP addresses and hit the providers' rate limits together; an open proxy invites abuse. Every route needs its entry in `src/worker/gateway/routes.ts` |
| Logging per chat line in the hub             | Every line becomes a billed log event, and chat content must never reach a log |
| Writing chat to Durable Object storage or KV | Billed per row or write, and the privacy policy says that chat is held in memory only |
| `routes` in `wrangler.jsonc`                 | Deployments replace the domains of the dashboard; deployments of forks fail |
| `workers_dev` or `preview_urls` set to `true`, or left out of `wrangler.jsonc` | The Worker becomes reachable outside the zone, where the zone's rate limiting rule and bot rule do not apply; see [step 6](#6-keep-the-worker-off-other-hostnames) |

## Configuration

| File                            | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `vite.config.ts`, `nitro` section | Build target, compatibility date, prerendered routes, redirects, response headers, the Worker's entry |
| `wrangler.jsonc`                | Worker name, bindings, the Durable Object migration, variables, logging |
| `src/worker/entry.ts`           | Entry of the Worker: exports `ChatHub`, answers `/api/` and passes everything else to Nitro |
| `src/worker/api.ts`             | `/api/irc`, `/api/data/` and `/api/status`                     |
| `src/worker/hub.ts`, `src/worker/relay/` | The chat relay                                        |
| `src/worker/gateway/`           | The data gateway; `routes.ts` is its allowlist and cache policy |
| `tsconfig.worker.json`          | Type check of `src/worker` against the types of the Workers runtime |
| `public/.assetsignore`          | Files in the build output that must not be published           |
| `src/server/bots.ts`, `src/server/block-bots.ts` | The bot check, and the middleware that applies it to chat pages; `src/worker/api.ts` applies it to the relay and the gateway |
| `src/lib/overlay/settings.ts`   | The options of an overlay link: defaults, parameters, limits   |
| `src/lib/theme/`                | Night mode                                                     |
| `public/robots.txt`             | Allows crawlers the start page and nothing else                |
| `src/server/uncached-errors.ts` | Marks error responses as uncacheable                           |
| `src/server/collapse-slashes.ts` | Redirects paths with doubled slashes to the clean path        |
| `scripts/fontshare.ts`          | Downloads the Fontshare fonts before `dev` and `build`; they are self-hosted and git-ignored |
| `scripts/e2e/`                  | End-to-end suite of the relay and the gateway, and a smoke test with real chat; see [Testing the relay](#testing-the-relay) |

`pnpm build` writes the Worker to `.output/server` and the static files to `.output/public`. It also merges `wrangler.jsonc` into `.output/server/wrangler.json`, which is the file Wrangler deploys.

`pnpm dev` runs on plain Node, where there are no Durable Objects and no KV. The dev server answers everything under `/api/` with 503 at once, so an overlay in development uses its direct connections.

Rules for changing the configuration:

- Set response headers in `routeRules` in `vite.config.ts`. They apply to static files and to pages rendered by the Worker. A `public/_headers` file would only apply to static files. Responses under `/api/` never pass through Nitro and carry only the headers that `src/worker` sets.
- Change the compatibility date in `vite.config.ts` only. The build copies it into the Wrangler configuration.
- Do not add `main`, `assets` or `compatibility_date` to `wrangler.jsonc`. The build sets them.
- Do not add `env` blocks to `wrangler.jsonc`. Wrangler refuses to deploy a generated configuration that contains environments. Use preview builds for testing.
- Do not leave a comma after the last entry of `wrangler.jsonc`. The build cannot read it.
- Keep every Cloudflare setting in `wrangler.jsonc`, not under `nitro.cloudflare.wrangler` in `vite.config.ts`. The build merges both, and lists such as `migrations` would contain their entries twice.
- Only append to `migrations`; never edit or remove an entry. Do not add `exports`: Wrangler refuses both together, and a Worker that was deployed with `exports` cannot return to `migrations`.
- Keep `workers_dev` and `preview_urls` in `wrangler.jsonc`, both `false`. Left out, `workers_dev` switches the `workers.dev` URL on again, and `preview_urls` leaves the preview URLs as the dashboard has them.
- Repeat in `previews` every binding and variable that the Worker cannot run without.
- Do not add `limits.cpu_ms`. The limit would apply to the hubs as well, and a busy hub that exceeds it is reset together with all its overlay connections.
- The Content Security Policy is deliberately minimal. Emotes and badges load from many third-party hosts, so an allowlist for images or connections would break the overlay whenever a provider is added.
- The policy sends `frame-ancestors 'none'` on every response except `/chat/**`, so only overlay pages can be embedded in frames. The preview on the start page and streaming tools other than OBS load them in frames. Do not put static files under `public/chat/`: they would receive both policies.
- Keep the redirect of `/setup` at status 302. A browser keeps a 301 even if the path becomes a page again.

## Overlay options

The options travel in the query string of the overlay link, so they need no storage and no account. `src/lib/overlay/settings.ts` defines them, the start page writes them and the overlay reads them. Only values that differ from the default appear in a link, in the order of this table, and a link without parameters shows the default look.

| Parameter  | Values                               | Default  | Effect                                              |
| ---------- | ------------------------------------ | -------- | --------------------------------------------------- |
| `size`     | `1`, `2`, `3`                        | `1`      | Text size                                           |
| `font`     | `system`, `sans`, `display`, `mono`, `serif`, `alsina` | `system` | Font; all are self-hosted or system fonts |
| `stroke`   | `0` to `3`                           | `0`      | Text outline                                        |
| `shadow`   | `0` to `3`                           | `1`      | Text shadow                                         |
| `emotes`   | `1`, `2`, `3`                        | `1`      | Emote size relative to the text                     |
| `animate`  | `1`, `0`                             | `1`      | New lines slide in                                  |
| `fade`     | `0` to `600`                         | `0`      | Seconds until a line fades out; `0` keeps it        |
| `badges`   | `1`, `0`                             | `1`      | Show badges                                         |
| `bots`     | `1`, `0`                             | `1`      | Show messages of well-known bots                    |
| `commands` | `1`, `0`                             | `1`      | Show messages that start with `!`                   |
| `caps`     | `1`, `0`                             | `0`      | Small caps                                          |
| `ignore`   | Up to 20 logins, separated by commas | none     | Hide the messages of these accounts                 |
| `custom`   | Font name of up to 40 characters: letters, digits, space, hyphen, underscore, dot | none | A font installed on the computer that shows the overlay; comes before `font`. Anything else is dropped |
| `nl`       | `1`, `0`                             | `0`      | The message starts on a new line below the name     |
| `names`    | `1`, `0`                             | `1`      | Show user names                                     |
| `homies`   | `1`, `0`                             | `0`      | Show Chatterino Homies badges                       |

`demo=1` and `direct=1` are not part of the look: the first shows sample messages and connects to nothing, the second bypasses the relay and the gateway.

What operations need to know about them:

- Every overlay page is rendered by the Worker, so the whole link, options included, is in the request log. `ignore` names accounts; the privacy policy says so.
- `homies=1` is the only option that makes the overlay contact further hosts: the browser loads the badge lists from `chatterinohomies.com` and `itzalex.github.io` and the images from `cdn.chatterinohomies.com` and `itzalex.github.io`, directly and not through the gateway. It is off by default, and without it no request goes to any of them.
- `custom` names a font of the streamer's computer. Nothing is downloaded for it, and a font that is not installed falls back to `font`.
- An option is never removed or given another meaning once it has shipped: the links are in OBS scenes.

## Night mode

The start page and the legal pages follow the device's light or dark setting; the button in the header overrides it. The night version is generated by Dark Reader, which is part of the build and loaded from the site itself. The choice is kept in the browser's local storage under `theme`, only after a visitor used the button, and is never sent anywhere. It is the only value the site stores in a browser, and the privacy policy names it. Overlay pages are never themed.

## Legal pages

`/imprint` and `/privacy`, with the German versions `/impressum` and `/datenschutz`, are linked from every page's footer and prerendered. The operator's details live only in `src/components/legal/OperatorAddress.tsx`.

The privacy policy names every service a visitor's browser connects to, what passes through the relay and the gateway, what the browser stores and every log Petal keeps. Update both language versions in the same change as any of these:

- A new emote, badge or chat provider, or a new third-party host on any page. Fonts, scripts and images for the start page are self-hosted and must stay that way. The list of services, with the hosts the browser connects to for each, is in `src/components/legal/services.ts`. Image hosts come from each provider's own list, not from the code (Chatterino's list points to fourtf.com), so check them against what the lists answer.
- A new overlay option that makes the overlay contact a host, as `homies` does, or another host for an existing one.
- A change to what the relay holds: another default of `REPLAY_LINES`, or chat written anywhere but memory.
- A change to what the gateway fetches or how long it keeps it: a new route or a longer lifetime in `src/worker/gateway/routes.ts`.
- A change to what the browser still loads directly: images or the providers' live updates moved behind the Worker, or a change to the fallback.
- A new kind of data point in Analytics Engine, or anything in a log beyond what Cloudflare writes per request.
- Workers Cache, or different `observability` settings in `wrangler.jsonc`.
- Anything stored in the browser besides the theme choice under `theme`, cookies, or analytics of visitors of any kind.
- A change to whom the Worker refuses as a bot, if it looks at more than the user agent.

## Troubleshooting

| Symptom                                           | Cause and fix                                              |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Build fails while installing dependencies         | The pnpm versions do not agree. Make `packageManager` in `package.json` and `pnpm-lock.yaml` name the same version. |
| Deploy fails with an authentication error (code 10000) | The token in `CLOUDFLARE_API_TOKEN` lacks a permission, has expired, or the secret is not allowed for the repository. Create a new token as described above and replace the secret. |
| Deploy fails with "Redirected configurations cannot include environments" | `wrangler.jsonc` contains an `env` block. Remove it. |
| Deploy fails after a `routes` entry was added to `wrangler.jsonc` | The zone is in another account, or a DNS record for the hostname already exists. Remove the entry: the hostnames are attached in the dashboard. |
| Deploy fails with "You need to enable Analytics Engine" (code 10089) | Analytics Engine is not enabled in the account. Enable it, then retry the build. The version that was running keeps serving. |
| Deploy fails because a KV namespace named `petal-cache` already exists (code 10014) | An earlier deployment created the namespace and failed before it was bound. Copy the id of the namespace from **Storage & databases > KV** into the `CACHE` entry of `wrangler.jsonc` as `"id"`, or delete the namespace. |
| Deploy fails with "does not export class ChatHub" (code 10064) | The commit removed the relay. The class must stay exported as long as the Durable Object exists. |
| Deploy fails with "`migrations` and `exports` are mutually exclusive" | `wrangler.jsonc` contains both. Remove `exports`. |
| Deploy fails because the Worker name does not match, the build log warns "Failed to match Worker name", or Cloudflare opens a pull request that changes `name` | The project name in the dashboard differs from `name` in `wrangler.jsonc`. Cloudflare deploys under the dashboard name. Use `petal` in both places. |
| `/api/irc` answers 503                            | The body names the reason: `relay_disabled` (`RELAY_ENABLED` is `false`), `hub_full` or `channels_full` (raise `RELAY_SHARDS`), `relay_paused` (the hub paused itself and opens again after the time in `retry-after`; see [Safety switches](#safety-switches)), `relay_unavailable` (the hub failed or did not answer within 5 seconds; look for errors under **Observability** of the Worker). Overlays are on their direct connection. |
| `/api/irc` or `/api/data/` answers 429            | The client address exceeded a rate limit of the Worker. Overlays fall back to their direct connections. |
| `/api/irc` answers 403                            | `foreign_origin`: the page that opens the connection is served from another host than the Worker. The relay only serves overlays of its own deployment. `automated_client`: the client sent no user agent, or that of a crawler or a tool; see [Block bots on the chat routes](#8-block-bots-on-the-chat-routes). |
| `/api/data/` answers 403                          | `automated_client`, as above. The overlay of a browser or of OBS is never refused for this reason. |
| An overlay stays empty in a streaming tool        | If the page itself answers 403, the tool's user agent names it as a program. Add it to `test/bots.test.ts` and correct `src/server/bots.ts`. If chat is missing or emote animations stand still in OBS, check the version: see [What streamers need](#what-streamers-need). |
| The build log says "No targets deployed for petal" | Expected. The domains are attached in the dashboard, and the Worker has no `workers.dev` URL. Wrangler only lists what it deployed itself. |
| The build log of a preview says "This Preview deployment has no active URLs" | Expected: `preview_urls` is `false`. See [Releasing](#releasing). |
| A preview build fails because the Wrangler configuration has no `previews` block | `wrangler.jsonc` lost the block. Restore it: `wrangler preview` refuses to run without one. |
| A preview answers with error 1101 under `/api/`   | The `previews` block lacks the `CHAT_HUB` binding. |
| The relay was switched off in the dashboard and is on again | A deployment from `main` replaced the variables. Set `RELAY_ENABLED` in `wrangler.jsonc`. |
| `/imprint` redirects to `/imprint/`               | `prerender.autoSubfolderIndex` was removed from `vite.config.ts`. |

## Deploying from GitHub Actions instead

If Cloudflare's build cannot be used, the same deployment works from GitHub Actions. Disconnect the repository in the Cloudflare dashboard first, so that pushes are not deployed twice.

1. Create an API token under **Manage Account > Account API Tokens** with the Workers role **Editor** (legacy name: **Account > Workers Scripts > Edit**) and the permission **Account > Workers KV Storage > Edit**, which the first deployment needs to create the cache namespace.
2. In the GitHub repository, create an environment named `production` that is restricted to the `main` branch. Add the token as the environment secret `CLOUDFLARE_API_TOKEN` and the account ID as the variable `CLOUDFLARE_ACCOUNT_ID`.
3. Add a workflow that runs on pushes to `main`. Its job declares `environment: production`, uses the same setup steps as `.github/workflows/ci.yml`, and ends with the steps below. Without `environment: production` the secret and the variable are empty and the deploy fails on authentication.

   ```yaml
   - run: pnpm build
   - run: npx wrangler@4 deploy
     env:
       CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
   ```

Do not run deployments on `pull_request_target`, and do not pass the token to pull requests from forks.
