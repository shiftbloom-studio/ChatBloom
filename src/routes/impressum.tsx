import { Show } from "solid-js";

import LegalPage from "~/components/legal/LegalPage";
import OperatorAddress, { operator } from "~/components/legal/OperatorAddress";

// Keep in step with the English version, imprint.tsx.
export default function Impressum() {
    return (
        <LegalPage lang="de" title="Impressum" translation="/imprint">
            <p>Angaben gemäß § 5 DDG:</p>
            <OperatorAddress lang="de" />
            <p>
                E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
                <br />
                Telefon:{" "}
                <a href={`tel:${operator.phone.replace(/[^\d+]/g, "")}`}>{operator.phone}</a>
            </p>
            <Show when={operator.vatId}>
                {(vatId) => <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {vatId()}</p>}
            </Show>

            <h2>Verbraucherstreitbeilegung</h2>
            <p>
                Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
                Verbraucherschlichtungsstelle teilzunehmen.
            </p>

            <h2>Unabhängigkeit</h2>
            <p>
                Petal ist ein unabhängiges Open-Source-Projekt. Es steht in keiner Verbindung zu
                Twitch, 7TV, BetterTTV, FrankerFaceZ oder Chatterino und wird von ihnen weder
                unterstützt noch empfohlen. Namen und Logos gehören ihren jeweiligen Inhabern.
            </p>
        </LegalPage>
    );
}
