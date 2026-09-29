import { For } from "solid-js";

// Every third-party service an overlay page connects to, as named by both privacy policies.
// Keep it in step with src/lib/chat/ (see docs/DEPLOYMENT.md, "Legal pages").
const services = [
    {
        name: "Twitch",
        operator: "Twitch Interactive, Inc., USA",
        purpose: { en: "chat and emotes", de: "Chat und Emotes" },
        privacy: "https://legal.twitch.com/legal/privacy-notice/",
    },
    {
        name: "IVR",
        operator: "api.ivr.fi",
        purpose: { en: "Twitch badges", de: "Twitch-Badges" },
        privacy: "https://ivr.fi",
    },
    {
        name: "7TV",
        operator: "7TV",
        purpose: {
            en: "emotes, badges and name paints",
            de: "Emotes, Badges und Name-Paints",
        },
        privacy: "https://7tv.app/legal/privacy",
    },
    {
        name: "BetterTTV",
        operator: "NightDev, LLC, USA",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        privacy: "https://betterttv.com/privacy",
    },
    {
        name: "FrankerFaceZ",
        operator: "FrankerFaceZ",
        purpose: { en: "emotes and badges", de: "Emotes und Badges" },
        privacy: "https://www.frankerfacez.com/privacy",
    },
    {
        name: "FFZ Add-On Pack",
        operator: "FFZ:AP",
        purpose: { en: "badges", de: "Badges" },
        privacy: "https://ffzap.com",
    },
    {
        name: "Chatterino",
        operator: "Chatterino",
        purpose: { en: "badges", de: "Badges" },
        privacy: "https://chatterino.com",
    },
];

export default function OverlayServices(props: { lang: "en" | "de" }) {
    return (
        <ul>
            <For each={services}>
                {(service) => (
                    <li>
                        <strong>{service.name}</strong> ({service.operator}):{" "}
                        {service.purpose[props.lang]}.{" "}
                        <a href={service.privacy}>
                            {props.lang === "de" ? "Datenschutzerklärung" : "Privacy policy"}
                        </a>
                    </li>
                )}
            </For>
        </ul>
    );
}
