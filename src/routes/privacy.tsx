import LegalPage from "~/components/legal/LegalPage";
import OperatorAddress, { operator } from "~/components/legal/OperatorAddress";
import OverlayServices from "~/components/legal/OverlayServices";

// Names every service a visitor's browser talks to and every log Petal keeps: update it
// with them (docs/DEPLOYMENT.md, "Legal pages"). Keep in step with the German version,
// datenschutz.tsx.
export default function Privacy() {
    return (
        <LegalPage
            lang="en"
            title="Privacy policy"
            translation="/datenschutz"
            updated="Last updated 29 September 2026"
        >
            <p>
                Petal has no accounts and uses neither cookies nor local storage. There is no
                analytics, tracking or advertising, and no automated decision-making about you. This
                policy covers the personal data that is processed nonetheless when you use
                chat.shiftbloom.studio, above all your IP address.
            </p>

            <h2>Controller</h2>
            <OperatorAddress lang="en" />
            <p>
                Email: <a href={`mailto:${operator.email}`}>{operator.email}</a>
            </p>

            <h2>Hosting</h2>
            <p>
                Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, delivers all of
                Petal's pages and files, fonts included, on our behalf. To do so, Cloudflare
                processes your IP address, the address of the page you request, the time, and
                details your browser sends, such as its user agent and the page you came from. You
                don't have to provide this data, but without it the site can't be shown to you.
            </p>
            <p>
                Requests that our Worker handles (overlay pages, redirects and error pages) are also
                logged, including the IP address and the approximate location Cloudflare derives
                from it. We use these logs only to fix errors and to prevent abuse, and they are
                deleted after at most 7 days.
            </p>
            <p>
                The legal basis is our legitimate interest in running Petal securely and reliably
                (Art. 6(1)(f) GDPR). Cloudflare processes the data as our processor under a data
                processing agreement (Art. 28 GDPR). Cloudflare, Inc. is certified under the EU-U.S.
                Data Privacy Framework, for which the European Commission has adopted an adequacy
                decision (Art. 45 GDPR); the agreement also contains the EU standard contractual
                clauses. More in{" "}
                <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.
            </p>

            <h2>Chat overlay</h2>
            <p>
                An overlay page (/v3/chat/…) runs in your browser or in OBS and connects it directly
                to the services below, to load the chat of the channel shown along with its emotes,
                badges and name paints. The services receive your IP address and browser details,
                and most of them the Twitch channel. The connection to Twitch chat is anonymous and
                read-only: you don't sign in, and Petal never sees any Twitch credentials.
            </p>
            <OverlayServices lang="en" />
            <p>
                The legal basis is our legitimate interest in showing the chat you open, which needs
                these connections (Art. 6(1)(f) GDPR). Each service processes the data under its own
                responsibility. Twitch, BetterTTV and FrankerFaceZ are based in the USA and aren't
                certified under the EU-U.S. Data Privacy Framework, and not every other service says
                where it is based. Where no adequacy decision applies, the transfer is necessary to
                provide the overlay you requested (Art. 49(1)(b) GDPR).
            </p>

            <h2>If you chat in a channel that uses Petal</h2>
            <p>
                The overlay shows chat messages on stream with display name, color and badges, as
                Twitch delivers them. This happens only in the browser that runs the overlay:
                Petal's servers never receive chat messages. The overlay keeps the latest 100
                messages in memory and forgets them when it's closed. Messages deleted by
                moderators, and messages from accounts that get timed out or banned, disappear from
                it as well. Whether chat appears on a stream is up to the streamer.
            </p>

            <h2>Email</h2>
            <p>
                If you email us, we use your address and message only to reply (Art. 6(1)(f) GDPR)
                and delete them once the matter is settled, unless the law requires us to keep them.
            </p>

            <h2>Your rights</h2>
            <p>
                You have the right of access to your personal data (Art. 15 GDPR), to rectification
                (Art. 16), to erasure (Art. 17), to restriction of processing (Art. 18) and to data
                portability (Art. 20). To exercise them, email us. You can also lodge a complaint
                with a data protection supervisory authority (Art. 77 GDPR), for example the one
                where you live or the one responsible for us: Unabhängiges Landeszentrum für
                Datenschutz Schleswig-Holstein, Postfach 71 16, 24171 Kiel.
            </p>

            <h2>Right to object</h2>
            <p>
                <strong>
                    You may object at any time, on grounds relating to your particular situation, to
                    the processing of your personal data based on Art. 6(1)(f) GDPR (Art. 21 GDPR).
                </strong>
            </p>
        </LegalPage>
    );
}
