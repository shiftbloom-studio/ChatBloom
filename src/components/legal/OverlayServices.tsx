import { For } from "solid-js";

// Every third-party service an overlay page connects to, as named by both privacy policies.
// Keep it in step with src/lib/chat/ (see docs/DEPLOYMENT.md, "Legal pages"). Operators are
// only named where the service names one that could be verified; FFZ:AP, Chatterino and IVR
// publish no privacy policy, so they link their website instead.
const services: {
    name: string;
    operator?: string;
    purpose: { en: string; de: string };
    url: string;
    policy?: boolean;
}[] = [
    {
        name: "Twitch",
        operator: "Twitch Interactive, Inc., USA",
        purpose: { en: "chat and emotes", de: "Chat und Emotes" },
        url: "https://legal.twitch.com/legal/privacy-notice/",
        policy: true,
    },
    {
        name: "IVR",
        purpose: { en: "Twitch badges", de: "Twitch-Badges" },
        url: "https://api.ivr.fi/v2/docs",
    },
    {
        name: "7TV",
        purpose: { en: "emotes, badges and name paints", de: "Emotes, Badges und Name-Paints" },
        url: "https://7tv.app/privacy",
        policy: true,
    },
    {
        name: "BetterTTV",
        operator: "NightDev, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        url: "https://betterttv.com/privacy",
        policy: true,
    },
    {
        name: "FrankerFaceZ",
        operator: "Dan Salvato, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        url: "https://www.frankerfacez.com/privacy",
        policy: true,
    },
    {
        name: "FFZ Add-On Pack",
        purpose: { en: "badges", de: "Badges" },
        url: "https://ffzap.com",
    },
    {
        name: "Chatterino",
        purpose: { en: "badges", de: "Badges" },
        url: "https://chatterino.com",
    },
];

export default function OverlayServices(props: { lang: "en" | "de" }) {
    const policy = () => (props.lang === "de" ? "Datenschutzerklärung" : "Privacy policy");
    return (
        <ul>
            <For each={services}>
                {(service) => (
                    <li>
                        <strong>{service.name}</strong>
                        {service.operator && ` (${service.operator})`}:{" "}
                        {`${service.purpose[props.lang]}. `}
                        <a href={service.url}>{service.policy ? policy() : "Website"}</a>
                    </li>
                )}
            </For>
        </ul>
    );
}
