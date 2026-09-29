<p align="center">
  <a href="https://petal.shiftbloom.studio"><img src="public/og.png" alt="Petal: put your chat on screen. A free, open-source Twitch chat overlay for OBS." width="720"></a>
</p>

<h1 align="center">Petal: Twitch chat overlay for OBS</h1>

<p align="center">
  <b>Put your Twitch chat on screen.</b><br>
  A free, open-source chat overlay with 7TV, BetterTTV (BTTV) and FrankerFaceZ (FFZ) emotes,
  badges and name paints.<br>
  No account. No login. Nothing to install.
</p>

<p align="center">
  <a href="https://petal.shiftbloom.studio"><b>Make your overlay link</b></a>
  &nbsp;·&nbsp; <a href="#get-started">Get started</a>
  &nbsp;·&nbsp; <a href="#faq">FAQ</a>
  &nbsp;·&nbsp; <a href="#run-it-yourself">Run it yourself</a>
  &nbsp;·&nbsp; <a href="docs">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/shiftbloom-studio/ChatBloom/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/shiftbloom-studio/ChatBloom/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue"></a>
</p>

Petal turns your Twitch chat into a transparent browser source for OBS. Type your channel, copy
the link, and your chat is on screen, with every emote, badge and name paint your viewers expect
to see.

## Why Petal

- **Three steps, no account.** Enter your channel, copy the link, add a browser source. Petal
  never asks for a Twitch login, a token or any permission on your account.
- **Every emote.** Twitch, 7TV, BTTV and FFZ: global, channel and personal sets, zero-width
  emotes and emote modifiers. Emotes added or removed mid-stream show up without a reload.
- **Badges and name paints.** Badges from Twitch, 7TV, BTTV, FFZ, FFZ:AP and Chatterino. 7TV name
  paints and BTTV username effects.
- **Made for live.** Subscription notices, `/me` actions and Shared Chat messages are shown, and
  messages that moderators remove disappear from the overlay. Every connection reconnects on its
  own, so the source can stay in your scene for the whole stream.
- **Private by design.** Chat is read anonymously and read-only. No cookies, no ads, no analytics.
  The only thing kept in your browser is your light or dark choice on the start page.
- **Free and open source.** AGPL-3.0-or-later, made and hosted by
  [shiftbloom studio](https://shiftbloom.studio), an open digital studio in Hamburg.

|                    | Twitch | 7TV    | BTTV    | FFZ | FFZ:AP | Chatterino |
| ------------------ | :----: | :----: | :-----: | :-: | :----: | :--------: |
| Emotes             | ✓      | ✓      | ✓       | ✓   |        |            |
| Badges             | ✓      | ✓      | ✓       | ✓   | ✓      | ✓          |
| Name styling       |        | paints | effects |     |        |            |

## Get started

1. **Enter your channel.** Open [petal.shiftbloom.studio](https://petal.shiftbloom.studio) and type
   your Twitch channel into the field. A bare name, `@name` or a twitch.tv link all work.
2. **Copy the overlay link.** Press "Copy overlay URL". There is nothing to create and nothing to
   install.
3. **Add it to OBS.** In OBS, add a **Browser** source and paste the link as its URL. Size the
   source to the part of the scene where chat should sit. The page is transparent, and new
   messages stack up from its bottom edge.

Your link looks like this, with your own channel at the end:

```text
https://petal.shiftbloom.studio/v3/chat/yourchannel
```

Overlay links live in OBS scenes, so Petal keeps them working.

## FAQ

**Is Petal free?**
Yes. It costs nothing, shows no ads and needs no account. The source code is public under the
GNU Affero General Public License, version 3 or later.

**Do I have to log in with Twitch?**
No. Petal reads chat anonymously and read-only. It never asks for your Twitch login, a token or
any permission on your account.

**Does it work with Streamlabs and other streaming software?**
Petal is a web page, so it works in any streaming software that has a browser source, such as OBS
Studio and Streamlabs Desktop. To check a link, open it in a normal browser tab.

**What happens when a connection drops during a stream?**
The overlay reconnects on its own. Every connection it holds, to Twitch chat and to the emote
services, is re-established without a reload.

**Can I change the size, font or colors?**
Not yet. The overlay has one fixed look, and it fills the browser source you give it.

**Does Petal track me or my viewers?**
No. Petal has no accounts, sets no cookies and runs no analytics or advertising. See the
[privacy policy](https://petal.shiftbloom.studio/privacy).

**Is Petal a replacement for ChatIS?**
Petal is a fork of [ChatIS](https://github.com/IS2511/ChatIS) by IS2511, rebuilt and hosted by
shiftbloom studio. If you used ChatIS, make a new overlay link on the start page and swap it into
your browser source. Links made with ChatIS do not carry over.

The start page answers more of these, and
[petal.shiftbloom.studio/llms-full.txt](https://petal.shiftbloom.studio/llms-full.txt) has all of
it as Markdown.

## Run it yourself

You need Node.js 24 or newer and [pnpm](https://pnpm.io), at the version pinned in
`package.json`.

```bash
git clone https://github.com/shiftbloom-studio/ChatBloom.git
cd ChatBloom
pnpm install
pnpm dev
```

The dev server prints its address. Open `/` for the start page, or `/v3/chat/<channel>` for the
overlay of a channel. The first run downloads two free fonts from Fontshare; without a
connection, the pages fall back to system fonts. Run `pnpm check` (types, lint, tests) before you
push.

Petal runs on Cloudflare Workers. To host your own copy, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Page                                     | What is in it                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)     | How the overlay works, the services it talks to, the code layout     |
| [Contributing](docs/CONTRIBUTING.md)     | Development workflow, tests and the rules for changes                |
| [Deployment](docs/DEPLOYMENT.md)         | Hosting on Cloudflare: setup, costs and operations                   |
| [Search and language models](docs/SEO.md) | How the start page is written for search engines and AI assistants  |

## License and credits

Petal is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). If you
run a modified version as a network service, the AGPL requires you to offer its source code to
its users.

- Started from [ChatIS](https://github.com/IS2511/ChatIS) by IS2511. Petal was called ChatBloom
  while it was being built, and this repository keeps that name.
- [Clash Display and General Sans](https://www.fontshare.com) by the Indian Type Foundry, under
  the ITF Free Font License. They are downloaded at build time and not part of this repository.
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) under the SIL Open Font License, in
  `public/fonts/jetbrains-mono/`.
- Petal is not affiliated with or endorsed by Twitch, 7TV, BetterTTV, FrankerFaceZ or Chatterino.

Made by [shiftbloom studio](https://shiftbloom.studio) in Hamburg.
[Imprint](https://petal.shiftbloom.studio/imprint) ·
[Privacy](https://petal.shiftbloom.studio/privacy)
