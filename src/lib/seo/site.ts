// What search engines, link previews and language models are told about Petal. The start
// page's <head>, its visible copy, its structured data, `llms.txt` and the sitemap are all built
// from this module, so they cannot contradict each other. Nothing here touches the DOM, and the
// imports stay relative: `scripts/seo.ts` and the tests run this file on plain Node.
//
// Every sentence is a claim that gets quoted. Write only what the overlay does today.

import { versions } from "./image-versions";

const origin = "https://petal.shiftbloom.studio";
const repository = "https://github.com/shiftbloom-studio/petal";

export type SocialImage = {
    /** The format that scripts/og.html is asked for. */
    format: "landscape" | "square";
    /** Its name in `public/`. */
    file: keyof typeof versions;
    /** With the file's version, so that a changed image is a new address to every cache. */
    url: string;
    width: number;
    height: number;
    type: "image/png";
    alt: string;
};

function picture(
    format: SocialImage["format"],
    file: SocialImage["file"],
    width: number,
    height: number,
): SocialImage {
    return {
        format,
        file,
        url: `${origin}/${file}?v=${versions[file]}`,
        width,
        height,
        type: "image/png",
        // Read aloud in place of the image, so it says what the image says.
        alt: "A red flower above the words: Petal. Put your chat on screen. Free Twitch chat overlay for OBS.",
    };
}

// Rendered from scripts/og.html by `pnpm og`.
const landscape = picture("landscape", "og.png", 1200, 630);
const square = picture("square", "og-square.png", 1200, 1200);

export const site = {
    name: "Petal",
    /** Names people may still search for. */
    alternateNames: ["Petal chat overlay"],
    origin,
    /** The start page, and the only address that is meant to be found. */
    url: `${origin}/`,
    /** Where an overlay lives: `${origin}${overlayPath}<channel>`. */
    overlayPath: "/chat/",
    language: "en",
    /** At most 60 characters, or search results cut it off. */
    title: "Petal — free Twitch chat overlay for OBS: 7TV, BTTV, FFZ",
    /** Between 110 and 160 characters, for the same reason. */
    description:
        "Petal is a free, open-source Twitch chat overlay for OBS. Type your channel, copy the link, add a browser source. 7TV, BTTV and FFZ emotes, no login.",
    /** The line under a shared link. */
    socialTitle: "Petal — put your Twitch chat on screen",
    socialDescription:
        "A free, open-source Twitch chat overlay for OBS, with 7TV, BTTV and FFZ emotes, badges and name paints. No account, no login.",
    summary:
        "Petal is a free, open-source Twitch chat overlay for OBS and other streaming software with a browser source. A streamer types their channel on the start page, copies a link and adds it to a scene. The overlay shows live chat with emotes, badges and name paints from Twitch, 7TV, BetterTTV (BTTV) and FrankerFaceZ (FFZ).",
    /** Two facts that Slack shows as fields under a shared link. It has room for two. */
    socialFacts: [
        { label: "Price", value: "Free and open source" },
        { label: "Works with", value: "OBS Studio, Streamlabs Desktop" },
    ],
    /**
     * The image of a shared link, 1.91:1: the shape that Discord, X, Slack, WhatsApp, iMessage,
     * Telegram, LinkedIn and Facebook show. They take one image, so the tags name only this one.
     */
    image: landscape,
    /** Every shape, for structured data and the sitemap: search engines pick what fits. */
    images: [landscape, square],
    icon: `${origin}/apple-touch-icon.png`,
    repository,
    readme: "https://raw.githubusercontent.com/shiftbloom-studio/petal/main/README.md",
    license: {
        name: "GNU Affero General Public License v3.0 or later",
        spdx: "AGPL-3.0-or-later",
        url: "https://www.gnu.org/licenses/agpl-3.0.html",
    },
    /** The day the facts in this module last changed. Sitemap and structured data carry it. */
    updated: "2026-09-30",
} as const;

export const studio = {
    name: "shiftbloom studio",
    url: "https://shiftbloom.studio",
    email: "hello@shiftbloom.studio",
    description: "An open digital studio in Hamburg.",
    profiles: [
        "https://github.com/shiftbloom-studio",
        "https://opencollective.com/shiftbloom-studio",
    ],
} as const;

/** The project Petal was forked from. */
export const origins = {
    name: "ChatIS",
    author: "IS2511",
    repository: "https://github.com/IS2511/ChatIS",
} as const;

export type Step = { title: string; text: string };

/** From nothing to chat on screen. The sequence is the content. */
export const steps: readonly Step[] = [
    {
        title: "Enter your channel.",
        text: "Open petal.shiftbloom.studio and type your Twitch channel into the field. A bare name, @name or a twitch.tv link all work.",
    },
    {
        title: "Copy the overlay link.",
        text: "Press “Copy overlay URL”. There is no account to create and nothing to install.",
    },
    {
        title: "Add it to OBS.",
        text: "In OBS, add a Browser source and paste the link as its URL. Size the source to where chat should sit. Your chat is on screen.",
    },
];

/** What the overlay does, one fact per line. */
export const features: readonly string[] = [
    "Live Twitch chat as a transparent browser source for OBS",
    "Emotes from Twitch, 7TV, BetterTTV (BTTV) and FrankerFaceZ (FFZ): global, channel and personal sets",
    "Zero-width emotes and emote modifiers",
    "Emote sets that change during a stream update without a reload",
    "Badges from Twitch, 7TV, BTTV, FFZ, FFZ:AP and Chatterino",
    "7TV name paints and BTTV username effects",
    "Text size, font, outline, shadow and emote size are chosen on the start page, with a live preview",
    "Filters for bot messages, commands and chosen users",
    "Subscription notices, /me actions and Shared Chat messages",
    "Messages removed by moderators, timeouts and bans disappear from the overlay",
    "Anonymous and read-only: no Twitch login, no token, no account",
    "Every connection reconnects on its own",
    "Free and open source under the AGPL",
];

export type Question = {
    question: string;
    answer: string;
    /** Shown after the answer on the page. `llms-full.txt` carries it when it leaves the site. */
    link?: { label: string; href: string };
};

/** The questions streamers ask, answered so that each answer stands on its own. */
export const questions: readonly Question[] = [
    {
        question: "What is Petal?",
        answer: "Petal is a free, open-source chat overlay for Twitch streamers. It puts your live chat on stream through a browser source in OBS, with emotes, badges and name paints from Twitch, 7TV, BetterTTV and FrankerFaceZ. It is made by shiftbloom studio, an open digital studio in Hamburg.",
    },
    {
        question: "How do I add Twitch chat to OBS?",
        answer: "Open petal.shiftbloom.studio, type your Twitch channel into the field and copy the overlay link. In OBS, add a Browser source, paste the link as its URL and size the source to the part of the scene where chat should sit. The page is transparent, and new messages stack up from its bottom edge.",
    },
    {
        question: "Is Petal free?",
        answer: "Yes. Petal costs nothing, shows no ads and needs no account. Its source code is public under the GNU Affero General Public License, version 3 or later.",
        link: { label: "Source on GitHub", href: repository },
    },
    {
        question: "Do I have to log in with Twitch?",
        answer: "No. Petal reads chat anonymously and read-only. It never asks for your Twitch login, a token or any permission on your account.",
    },
    {
        question: "Which emotes and badges does Petal show?",
        answer: "Emotes from Twitch, 7TV, BetterTTV (BTTV) and FrankerFaceZ (FFZ): global, channel and personal sets, including zero-width emotes and emote modifiers. Badges from Twitch, 7TV, BTTV, FFZ, FFZ:AP and Chatterino. Name paints from 7TV. Emotes that are added or removed during a stream show up without a reload.",
    },
    {
        question: "Does Petal work with Streamlabs and other streaming software?",
        answer: "Petal is a web page, so it works in any streaming software that has a browser source, such as OBS Studio and Streamlabs Desktop. To check a link, open it in a normal browser tab.",
    },
    {
        question: "What happens when a connection drops during a stream?",
        answer: "The overlay reconnects on its own. Every connection it holds, to Twitch chat and to the emote services, is re-established without a reload, so the browser source can stay in your scene for the whole stream.",
    },
    {
        question: "Is Petal a replacement for ChatIS?",
        answer: "Petal is a fork of ChatIS by IS2511, rebuilt and hosted by shiftbloom studio. If you used ChatIS, make a new overlay link here and swap it into your browser source. Links made with ChatIS do not carry over.",
        link: { label: "ChatIS on GitHub", href: origins.repository },
    },
    {
        question: "Does Petal track me or my viewers?",
        answer: "No. Petal has no accounts, sets no cookies and runs no analytics or advertising.",
        link: { label: "Privacy policy", href: "/privacy" },
    },
];
