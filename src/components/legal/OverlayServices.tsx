import { For } from "solid-js";

// Every third-party service behind an overlay page, as named by both privacy policies: what it
// supplies, and what the visitor's browser loads from it directly while the relay and the
// gateway work. In the fallback the browser asks every one of them directly, which the
// policies say in their own words. Keep it in step with src/lib/chat/ and src/worker/gateway/
// (see docs/DEPLOYMENT.md, "Legal pages"). Operators are only named where the service names
// one that could be verified; FFZ:AP, Chatterino and IVR publish no privacy policy, so they
// link their website instead.
const images = { en: "images", de: "Bilder" };
const imagesAndUpdates = {
    en: "images and live updates",
    de: "Bilder und Live-Aktualisierungen",
};
// IVR only lists the badges; their images are Twitch's.
const fallbackOnly = { en: "nothing, except in the fallback", de: "nichts, außer im Ersatzfall" };
// Homies is not behind the gateway: the browser loads its lists as well, from
// chatterinohomies.com and itzalex.github.io, which the policies name.
const listsAndImages = { en: "badge lists and images", de: "Badge-Listen und Bilder" };

const services: {
    name: string;
    operator?: string;
    purpose: { en: string; de: string };
    direct: { en: string; de: string };
    url: string;
    policy?: boolean;
}[] = [
    {
        name: "Twitch",
        operator: "Twitch Interactive, Inc., USA",
        purpose: { en: "chat and emotes", de: "Chat und Emotes" },
        direct: images,
        url: "https://legal.twitch.com/legal/privacy-notice/",
        policy: true,
    },
    {
        name: "IVR",
        purpose: { en: "Twitch badges", de: "Twitch-Badges" },
        direct: fallbackOnly,
        url: "https://api.ivr.fi/v2/docs",
    },
    {
        name: "7TV",
        purpose: { en: "emotes, badges and name paints", de: "Emotes, Badges und Name-Paints" },
        direct: imagesAndUpdates,
        url: "https://7tv.app/privacy",
        policy: true,
    },
    {
        name: "BetterTTV",
        operator: "NightDev, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        direct: imagesAndUpdates,
        url: "https://betterttv.com/privacy",
        policy: true,
    },
    {
        name: "FrankerFaceZ",
        operator: "Dan Salvato, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        direct: imagesAndUpdates,
        url: "https://www.frankerfacez.com/privacy",
        policy: true,
    },
    {
        name: "FFZ Add-On Pack",
        purpose: { en: "badges", de: "Badges" },
        direct: images,
        url: "https://ffzap.com",
    },
    {
        name: "Chatterino",
        purpose: { en: "badges", de: "Badges" },
        direct: images,
        url: "https://chatterino.com",
    },
    {
        name: "Chatterino Homies",
        purpose: {
            en: "badges, only if the address of the overlay contains homies=1",
            de: "Badges, nur wenn die Adresse des Overlays homies=1 enthält",
        },
        direct: listsAndImages,
        url: "https://chatterinohomies.com/privacy-policy",
        policy: true,
    },
];

export default function OverlayServices(props: { lang: "en" | "de" }) {
    const policy = () => (props.lang === "de" ? "Datenschutzerklärung" : "Privacy policy");
    const direct = () =>
        props.lang === "de"
            ? "Direkt von deinem Browser geladen"
            : "Loaded directly by your browser";
    return (
        <ul>
            <For each={services}>
                {(service) => (
                    <li>
                        <strong>{service.name}</strong>
                        {service.operator && ` (${service.operator})`}:{" "}
                        {`${service.purpose[props.lang]}. `}
                        {`${direct()}: ${service.direct[props.lang]}. `}
                        <a href={service.url}>{service.policy ? policy() : "Website"}</a>
                    </li>
                )}
            </For>
        </ul>
    );
}
