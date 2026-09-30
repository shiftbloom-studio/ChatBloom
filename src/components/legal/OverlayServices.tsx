import { For } from "solid-js";

import { hostsSentence, type Lang, overlayServices } from "./services";

// The list of services in both privacy policies, from the entries in services.ts.
export default function OverlayServices(props: { lang: Lang }) {
    const policy = () => (props.lang === "de" ? "Datenschutzerklärung" : "Privacy policy");
    const direct = () =>
        props.lang === "de"
            ? "Direkt von deinem Browser geladen"
            : "Loaded directly by your browser";
    return (
        <ul>
            <For each={overlayServices}>
                {(service) => (
                    <li>
                        <strong>{service.name}</strong>
                        {service.operator && ` (${service.operator})`}:{" "}
                        {`${service.purpose[props.lang]}. `}
                        {`${direct()}: ${service.direct[props.lang]}. `}
                        {`${hostsSentence(service, props.lang)} `}
                        <a href={service.url}>{service.policy ? policy() : "Website"}</a>
                    </li>
                )}
            </For>
        </ul>
    );
}
