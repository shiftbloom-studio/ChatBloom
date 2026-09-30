import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import type { HomiesBadge, HomiesBadges } from "./providers/homies";
import type { Paint } from "./providers/seventv/paint";
import type { ChatMessage, ChatSession } from "./session";
import { type MessagePart, tokenize } from "./tokenize";
import type { Badge, Emote } from "./types";

/** Whether an overlay link asks for the demo chat (`demo=1`). */
export function isDemo(params: URLSearchParams): boolean {
    return params.get("demo") === "1";
}

import { bttvEmote } from "./providers/bttv";
import {
    fetchTwitchChannelBadges,
    fetchTwitchUserId,
    type TwitchBadges,
    twitchEmote,
} from "./providers/twitch";

// The real images, from the hosts an overlay page loads them from anyway (see the privacy
// policy, "Chat overlay"): Twitch's global badges and emotes, emotes of the 7TV and BetterTTV
// global sets, and a shared Homies badge. Nothing is invented and nothing ships with the site.
const TWITCH_BADGES = "https://static-cdn.jtvnw.net/badges/v1";
const SEVENTV_CDN = "https://cdn.7tv.app/emote";

const twitchBadge = (set: string, image: string, title: string): Badge => ({
    provider: "twitch",
    id: `${set}/1`,
    title,
    images: {
        1: `${TWITCH_BADGES}/${image}/1`,
        2: `${TWITCH_BADGES}/${image}/2`,
        4: `${TWITCH_BADGES}/${image}/3`,
    },
});

const sevenTVEmote = (id: string, name: string, width: number, height: number): Emote => ({
    provider: "7tv",
    id,
    name,
    images: {
        1: `${SEVENTV_CDN}/${id}/1x.webp`,
        2: `${SEVENTV_CDN}/${id}/2x.webp`,
        3: `${SEVENTV_CDN}/${id}/3x.webp`,
        4: `${SEVENTV_CDN}/${id}/4x.webp`,
    },
    width,
    height,
});

// Twitch's global emotes by their ids, the 7TV and BetterTTV global sets of September 2026.
const EMOTES = new Map(
    [
        twitchEmote("30259", "HeyGuys"),
        twitchEmote("305954156", "PogChamp"),
        twitchEmote("425618", "LUL"),
        twitchEmote("25", "Kappa"),
        twitchEmote("9", "<3"),
        sevenTVEmote("01GAZ199Z8000FEWHS6AT5QZV0", "peepoHappy", 32, 32),
        sevenTVEmote("01GB46137R000BJ5HR8F6XV8J1", "FeelsOkayMan", 32, 32),
        sevenTVEmote("01GAM8EFQ00004MXFXAJYKA859", "Clap", 22, 32),
        bttvEmote({ id: "566ca38765dbbdab32ec0560", code: "SourPls" }),
    ].map((emote) => [emote.name, emote]),
);

// Twitch's global badge sets, as messages refer to them. With a channel, its own subscriber
// and bits badges take the place of these, see `createDemoSession`.
const BADGES = new Map([
    ["moderator", twitchBadge("moderator", "3267646d-33f0-4b17-b3df-f923a41db1d0", "Moderator")],
    ["subscriber", twitchBadge("subscriber", "5d9f2208-5dd8-11e7-8513-2ff4adfae661", "Subscriber")],
    ["vip", twitchBadge("vip", "b817aba4-fad8-49e2-b88a-7cc744dfa6ec", "VIP")],
    // The set Twitch puts on bots, so the filter hides the demo bot like a real one.
    ["bot-badge", twitchBadge("bot-badge", "3ffa9565-c35b-4cad-800b-041e60659cf2", "Chat Bot")],
]);

// A shared badge of the Homies lists, which belongs to no single person.
const HOMIES_BADGE: HomiesBadge = {
    provider: "homies",
    id: "https://itzalex.github.io/badgesusers/supporter2/badge.png",
    title: "Homies Supporter",
    images: {
        1: "https://itzalex.github.io/badgesusers/supporter2/badge.png",
        2: "https://itzalex.github.io/badgesusers/supporter2/badge2x.png",
        4: "https://itzalex.github.io/badgesusers/supporter2/badge3x.png",
    },
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
    /** Badge references as Twitch sends them, `set/version`. */
    badges: string[];
    paint?: Paint;
}

// Invented people, under names that belonged to no Twitch account when the demo was written.
// Subscriber versions are months; a channel that has no badge for a version shows its first.
const mod: Chatter = {
    name: "Maple_Wren",
    color: "#3cb371",
    badges: ["moderator/1", "subscriber/12"],
};
const painted: Chatter = {
    name: "VelvetFinch",
    color: "#ff69b4",
    badges: ["subscriber/3"],
    paint: PAINT,
};
const subscriber: Chatter = { name: "Saffron_Owl", color: "#daa520", badges: ["subscriber/6"] };
const newSubscriber: Chatter = { name: "Marigold_Elk", color: "#ff7f50", badges: ["subscriber/0"] };
const vip: Chatter = { name: "driftwood_jay", color: "#b084f5", badges: ["vip/1"] };
const bot: Chatter = { name: "PetalHelperBot", color: "#9acd32", badges: ["bot-badge/1"] };
const newcomer: Chatter = { name: "pixel_heron", color: "#1e90ff", badges: [] };
// Bits badges exist per channel only, so this one shows with a channel that has them.
const regular: Chatter = { name: "willow_tern", color: "#00c8af", badges: ["bits/1000"] };
const lurker: Chatter = { name: "hazel_newt", color: "#ff4500", badges: [] };

interface Sample {
    chatter: Chatter;
    text: string;
    action?: boolean;
    system?: string;
}

const SAMPLES: Sample[] = [
    { chatter: mod, text: "Welcome in, everyone HeyGuys" },
    { chatter: newcomer, text: "first time here, this chat looks so clean" },
    // Long enough for several lines, and early enough to be on screen from the start.
    {
        chatter: regular,
        text: "I have been watching for two hours, I still do not understand the rules of this game, and I am having a great time",
    },
    { chatter: painted, text: "<3 <3 <3" },
    { chatter: bot, text: "Enjoying the stream? Follow the channel, so you never miss one." },
    { chatter: lurker, text: "!uptime" },
    { chatter: subscriber, text: "that was so close PogChamp" },
    { chatter: vip, text: "clip it, someone clip it LUL SourPls" },
    { chatter: newcomer, text: "@Maple_Wren thanks for the help earlier peepoHappy" },
    { chatter: painted, text: "waves at everyone who just got here", action: true },
    {
        chatter: newSubscriber,
        text: "Happy to be here FeelsOkayMan",
        system: "Marigold_Elk subscribed at Tier 1.",
    },
    { chatter: subscriber, text: "GG Clap Kappa" },
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
 * A chat session without a chat: it repeats a dozen invented messages and opens no connection.
 * Only its badge and emote images are loaded, from the hosts of the real ones. The start page
 * previews the overlay with it, and a streamer can arrange a scene with it while the channel is
 * offline.
 */
export interface DemoOptions {
    /**
     * A channel whose own Twitch badges the sample chat wears: its subscriber badges by
     * months, and its bits badge. Two requests through the gateway, no login, no connection.
     */
    channel?: string;
}

export function createDemoSession(options: DemoOptions = {}): ChatSession {
    const [state, setState] = createStore<ChatSession["state"]>({
        status: "connected",
        roomId: "demo",
        messages: [],
        users: {},
        paints: {},
        sevenTVBadges: {},
    });
    let count = 0;

    // The badges of the channel, once they are known; the global ones until then.
    const [channelBadges, setChannelBadges] = createSignal<TwitchBadges>();
    let wanted = true;
    if (options.channel) {
        fetchTwitchUserId(options.channel)
            .then((id) => (id ? fetchTwitchChannelBadges(id) : undefined))
            .then((badges) => {
                if (wanted && badges && badges.size > 0) setChannelBadges(badges);
            })
            .catch((error) => console.warn("[demo] channel badges", error));
    }

    function badge(set: string, version: string): Badge | undefined {
        const own = channelBadges();
        return (
            own?.get(`${set}/${version}`) ??
            (set === "subscriber" ? own?.get("subscriber/0") : undefined) ??
            BADGES.get(set)
        );
    }

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
            badgeRefs: chatter.badges.map((ref) => {
                const [set, version] = ref.split("/") as [string, string];
                return { set, version };
            }),
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
            message.badgeRefs.flatMap((ref) => badge(ref.set, ref.version) ?? []),
        paint: (message: ChatMessage) => CHATTERS.get(message.userId)?.paint,
        user: (message: ChatMessage) => state.users[message.userId],
        dispose() {
            wanted = false;
            clearTimeout(timer);
        },
    };
}
