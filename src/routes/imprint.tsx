import { Show } from "solid-js";

import LegalPage from "~/components/legal/LegalPage";
import OperatorAddress, { operator } from "~/components/legal/OperatorAddress";

// Keep in step with the German version, impressum.tsx.
export default function Imprint() {
    return (
        <LegalPage lang="en" title="Imprint" translation="/impressum">
            <p>Information pursuant to § 5 DDG:</p>
            <OperatorAddress lang="en" />
            <p>
                Email: <a href={`mailto:${operator.email}`}>{operator.email}</a>
                <br />
                Phone: <a href={`tel:${operator.phone.replace(/[^\d+]/g, "")}`}>{operator.phone}</a>
            </p>
            <Show when={operator.vatId}>
                {(vatId) => <p>VAT ID pursuant to § 27a UStG: {vatId()}</p>}
            </Show>

            <h2>Consumer dispute resolution</h2>
            <p>
                We are not willing or obliged to take part in dispute resolution proceedings before
                a consumer arbitration board.
            </p>

            <h2>Independence</h2>
            <p>
                ChatBloom is an independent open-source project. It is not affiliated with or
                endorsed by Twitch, 7TV, BetterTTV, FrankerFaceZ or Chatterino. Their names and
                logos belong to their respective owners.
            </p>
        </LegalPage>
    );
}
