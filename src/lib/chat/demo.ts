import { createStore } from "solid-js/store";

import type { HomiesBadge, HomiesBadges } from "./providers/homies";
import type { Paint } from "./providers/seventv/paint";
import type { ChatMessage, ChatSession } from "./session";
import { type MessagePart, tokenize } from "./tokenize";
import type { Badge, Emote, ImageSet } from "./types";

/** Whether an overlay link asks for the demo chat (`demo=1`). */
export function isDemo(params: URLSearchParams): boolean {
    return params.get("demo") === "1";
}

// Vector images from `public/demo/`, so one file serves every size and pixel density.
const image = (file: string): ImageSet => ({ 1: `/demo/${file}.svg` });

const emote = (kind: string): Emote => ({
    provider: "7tv",
    id: `demo-${kind}`,
    name: `Petal${kind}`,
    images: image(`emote-${kind.toLowerCase()}`),
    width: 28,
    height: 28,
});

const badge = (kind: string, title: string): Badge => ({
    provider: "twitch",
    id: `demo-${kind}`,
    title,
    images: image(`badge-${kind}`),
});

const EMOTES = new Map(
    ["Heart", "Smile", "Spin", "Star", "Wow"].map((kind) => [`Petal${kind}`, emote(kind)]),
);

// By the badge sets of Twitch, as messages refer to them.
const BADGES = new Map([
    ["moderator", badge("moderator", "Moderator")],
    ["subscriber", badge("subscriber", "Subscriber")],
    ["vip", badge("vip", "VIP")],
    // The set Twitch puts on bots, so the filter hides the demo bot like a real one.
    ["bot-badge", badge("bot", "Chat Bot")],
]);

// A drawing of our own in the place of a Homies badge: the demo asks no third party.
const HOMIES_BADGE: HomiesBadge = {
    provider: "homies",
    id: "demo-homies",
    title: "Homies",
    images: image("badge-homies"),
};

const PAINT: Paint = {
    id: "demo-paint",
    name: "Petal",
    layers: [{ opacity: 1, image: "linear-gradient(90deg, #ff2e52 0%, #ffd34d 100%)" }],
    filter: "drop-shadow(#000000 0px 0px 1px) drop-shadow(#000000 1px 1px 1px)",
};

interface Chatter {
    name: string;
    color: string;
    badges: string[];
    paint?: Paint;
}

// Invented people, under names that belonged to no Twitch account when the demo was written.
const mod: Chatter = { name: "Maple_Wren", color: "#3cb371", badges: ["moderator", "subscriber"] };
const painted: Chatter = {
    name: "VelvetFinch",
    color: "#ff69b4",
    badges: ["subscriber"],
    paint: PAINT,
};
const subscriber: Chatter = { name: "Saffron_Owl", color: "#daa520", badges: ["subscriber"] };
const newSubscriber: Chatter = { name: "Marigold_Elk", color: "#ff7f50", badges: ["subscriber"] };
const vip: Chatter = { name: "driftwood_jay", color: "#b084f5", badges: ["vip"] };
const bot: Chatter = { name: "PetalHelperBot", color: "#9acd32", badges: ["bot-badge"] };
const newcomer: Chatter = { name: "pixel_heron", color: "#1e90ff", badges: [] };
const regular: Chatter = { name: "willow_tern", color: "#00c8af", badges: [] };
const lurker: Chatter = { name: "hazel_newt", color: "#ff4500", badges: [] };

interface Sample {
    chatter: Chatter;
    text: string;
    action?: boolean;
    system?: string;
}

const SAMPLES: Sample[] = [
    { chatter: mod, text: "Welcome in, everyone PetalSmile" },
    { chatter: newcomer, text: "first time here, this chat looks so clean" },
    // Long enough for several lines, and early enough to be on screen from the start.
    {
        chatter: regular,
        text: "I have been watching for two hours, I still do not understand the rules of this game, and I am having a great time",
    },
    { chatter: painted, text: "PetalHeart PetalHeart PetalHeart" },
    { chatter: bot, text: "Enjoying the stream? Follow the channel, so you never miss one." },
    { chatter: lurker, text: "!uptime" },
    { chatter: subscriber, text: "that was so close PetalWow" },
    { chatter: vip, text: "clip it, someone clip it PetalSpin" },
    { chatter: newcomer, text: "@Maple_Wren thanks for the help earlier" },
    { chatter: painted, text: "waves at everyone who just got here", action: true },
    {
        chatter: newSubscriber,
        text: "Happy to be here PetalStar",
        system: "Marigold_Elk subscribed at Tier 1.",
    },
    { chatter: subscriber, text: "GG PetalStar PetalStar" },
];

const CHATTERS = new Map(SAMPLES.map(({ chatter }) => [chatter.name.toLowerCase(), chatter]));

/**
 * The Homies badges of the demo chat, by the user ids of its messages. The overlay shows them
 * for `homies=1`, in the place of the lists it would load for a real chat.
 */
export const DEMO_HOMIES_BADGES: HomiesBadges = new Map(
    [mod, regular, vip].map((chatter) => [chatter.name.toLowerCase(), [HOMIES_BADGE]]),
);

// A chat that is already talking: the overlay shows these at once.
const FIRST_LINES = 6;
// Milliseconds until the next line, in turns. Uneven, like a chat.
const PAUSES = [1200, 1800, 1000, 1600, 2000, 1400];
const MAX_MESSAGES = 100;

/**
 * A chat session without a chat: it repeats a dozen invented messages and connects to nobody.
 * Its images ship with the site. The start page previews the overlay with it, and a streamer
 * can arrange a scene with it while the channel is offline.
 */
export function createDemoSession(): ChatSession {
    const [state, setState] = createStore<ChatSession["state"]>({
        status: "connected",
        roomId: "demo",
        messages: [],
        users: {},
        paints: {},
        sevenTVBadges: {},
    });
    let count = 0;

    function addNext() {
        const { chatter, text, action, system } = SAMPLES[count % SAMPLES.length];
        const login = chatter.name.toLowerCase();
        const message: ChatMessage = {
            id: `demo-${count}`,
            roomId: "demo",
            userId: login,
            login,
            displayName: chatter.name,
            color: chatter.color,
            action: action ?? false,
            text,
            emoteRanges: [],
            badgeRefs: chatter.badges.map((set) => ({ set, version: "1" })),
            system,
        };
        count++;
        setState("messages", (messages) => [...messages.slice(1 - MAX_MESSAGES), message]);
    }

    for (let line = 0; line < FIRST_LINES; line++) addNext();
    let timer = setTimeout(function tick() {
        addNext();
        timer = setTimeout(tick, PAUSES[count % PAUSES.length]);
    }, PAUSES[0]);

    return {
        state,
        parts: (message: ChatMessage): MessagePart[] =>
            tokenize(message.text, message.emoteRanges, (name) => EMOTES.get(name)),
        badges: (message: ChatMessage): Badge[] =>
            message.badgeRefs.flatMap((ref) => BADGES.get(ref.set) ?? []),
        paint: (message: ChatMessage) => CHATTERS.get(message.userId)?.paint,
        user: (message: ChatMessage) => state.users[message.userId],
        dispose() {
            clearTimeout(timer);
        },
    };
}
