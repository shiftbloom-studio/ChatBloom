// Every third-party service behind an overlay page, as both privacy policies list them (see
// OverlayServices.tsx): what it supplies, what the visitor's browser loads from it directly while
// the relay and the gateway work, and the hosts it connects to for that. In the fallback the
// browser asks every one of them directly, which the policies say in their own words. Keep it in
// step with src/lib/chat/ and src/worker/gateway/ (see docs/DEPLOYMENT.md, "Legal pages").
// Operators are only named where the service names one that could be verified; FFZ:AP,
// Chatterino and IVR publish no privacy policy, so they link their website instead.

export type Lang = "en" | "de";

type Text = Record<Lang, string>;

export interface OverlayService {
    name: string;
    operator?: string;
    purpose: Text;
    /** What the browser loads from the service while the relay and the gateway work. */
    direct: Text;
    /**
     * The hosts the browser connects to for `direct`. Images load from wherever the service's
     * lists point, which is not always a host of the service's own name.
     */
    hosts: readonly string[];
    /** The hosts the browser asks on top of `hosts` in the fallback, for the chat or the lists. */
    fallbackHosts: readonly string[];
    url: string;
    /** `url` is a privacy policy, not just a website. */
    policy?: boolean;
}

const images = { en: "images", de: "Bilder" };
const imagesAndUpdates = {
    en: "images and live updates",
    de: "Bilder und Live-Aktualisierungen",
};
// IVR only lists the badges; their images are Twitch's.
const fallbackOnly = { en: "nothing, except in the fallback", de: "nichts, außer im Ersatzfall" };
// Homies is not behind the gateway: the browser loads its lists as well.
const listsAndImages = { en: "badge lists and images", de: "Badge-Listen und Bilder" };

// The image hosts are those the services' own lists pointed to on 30 September 2026.
export const overlayServices: readonly OverlayService[] = [
    {
        name: "Twitch",
        operator: "Twitch Interactive, Inc., USA",
        purpose: { en: "chat, emotes and badges", de: "Chat, Emotes und Badges" },
        direct: images,
        // Not a host of twitch.tv: Twitch serves the images of its emotes and badges from here.
        hosts: ["static-cdn.jtvnw.net"],
        fallbackHosts: ["irc-ws.chat.twitch.tv"],
        url: "https://legal.twitch.com/legal/privacy-notice/",
        policy: true,
    },
    {
        name: "IVR",
        purpose: { en: "the list of Twitch badges", de: "die Liste der Twitch-Badges" },
        direct: fallbackOnly,
        hosts: [],
        fallbackHosts: ["api.ivr.fi"],
        url: "https://api.ivr.fi/v2/docs",
    },
    {
        name: "7TV",
        purpose: { en: "emotes, badges and name paints", de: "Emotes, Badges und Name-Paints" },
        direct: imagesAndUpdates,
        hosts: ["cdn.7tv.app", "events.7tv.io"],
        fallbackHosts: ["7tv.io"],
        url: "https://7tv.app/privacy",
        policy: true,
    },
    {
        name: "BetterTTV",
        operator: "NightDev, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        direct: imagesAndUpdates,
        hosts: ["cdn.betterttv.net", "sockets.betterttv.net"],
        fallbackHosts: ["api.betterttv.net"],
        url: "https://betterttv.com/privacy",
        policy: true,
    },
    {
        name: "FrankerFaceZ",
        operator: "Dan Salvato, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        direct: imagesAndUpdates,
        hosts: ["cdn.frankerfacez.com", "pubsub.workers.frankerfacez.com"],
        fallbackHosts: ["api.frankerfacez.com"],
        url: "https://www.frankerfacez.com/privacy",
        policy: true,
    },
    {
        name: "FFZ Add-On Pack",
        purpose: { en: "badges", de: "Badges" },
        direct: images,
        // The list comes from the same host in the fallback.
        hosts: ["api.ffzap.com"],
        fallbackHosts: [],
        url: "https://ffzap.com",
    },
    {
        name: "Chatterino",
        purpose: { en: "badges", de: "Badges" },
        direct: images,
        // Not a host of chatterino.com: the badge list points every image to fourtf.com.
        hosts: ["fourtf.com"],
        fallbackHosts: ["api.chatterino.com"],
        url: "https://chatterino.com",
    },
    {
        name: "Chatterino Homies",
        purpose: {
            en: "badges, only if the address of the overlay contains homies=1",
            de: "Badges, nur wenn die Adresse des Overlays homies=1 enthält",
        },
        direct: listsAndImages,
        hosts: ["chatterinohomies.com", "cdn.chatterinohomies.com", "itzalex.github.io"],
        fallbackHosts: [],
        url: "https://chatterinohomies.com/privacy-policy",
        policy: true,
    },
];

function joined(hosts: readonly string[], lang: Lang): string {
    const and = lang === "de" ? " und " : " and ";
    return hosts.length > 1 ? `${hosts.slice(0, -1).join(", ")}${and}${hosts.at(-1)}` : hosts[0];
}

/** The sentence of a list entry that names the hosts of the service, with its full stop. */
export function hostsSentence(service: OverlayService, lang: Lang): string {
    const { hosts, fallbackHosts } = service;
    const label = hosts.length + fallbackHosts.length > 1 ? "Hosts" : "Host";
    if (hosts.length === 0) {
        return lang === "de"
            ? `${label} im Ersatzfall: ${joined(fallbackHosts, lang)}.`
            : `${label} in the fallback: ${joined(fallbackHosts, lang)}.`;
    }
    if (fallbackHosts.length === 0) return `${label}: ${joined(hosts, lang)}.`;
    return lang === "de"
        ? `${label}: ${joined(hosts, lang)}, im Ersatzfall auch ${joined(fallbackHosts, lang)}.`
        : `${label}: ${joined(hosts, lang)}, in the fallback also ${joined(fallbackHosts, lang)}.`;
}
