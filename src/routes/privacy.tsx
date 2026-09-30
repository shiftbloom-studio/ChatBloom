import LegalPage from "~/components/legal/LegalPage";
import OperatorAddress, { operator } from "~/components/legal/OperatorAddress";
import OverlayServices from "~/components/legal/OverlayServices";

// Names every service a visitor's browser talks to, what passes through the relay and the
// gateway, what the browser stores and every log Petal keeps: update it with them
// (docs/DEPLOYMENT.md, "Legal pages"). Keep in step with the German version, datenschutz.tsx.
export default function Privacy() {
    return (
        <LegalPage
            lang="en"
            title="Privacy policy"
            translation="/datenschutz"
            updated="Last updated 30 September 2026"
        >
            <p>
                Petal has no accounts and sets no cookies. There is no tracking or advertising, no
                analysis of visitors or their behavior, and no automated decision-making about you.
                The only thing Petal keeps in your browser is your choice of theme, and only once
                you make one (see "Theme"). This policy covers the personal data that is processed
                nonetheless when you use petal.shiftbloom.studio or chat.shiftbloom.studio, above
                all your IP address.
            </p>

            <h2>Controller</h2>
            <OperatorAddress lang="en" />
            <p>
                Email: <a href={`mailto:${operator.email}`}>{operator.email}</a>
            </p>

            <h2>Hosting</h2>
            <p>
                Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, delivers all of
                Petal's pages and files, fonts included, on our behalf, and runs our chat relay and
                our cache for emote and badge data (see "Chat overlay"). To do so, Cloudflare
                processes your IP address, the address of the page you request, the time, and
                details your browser sends, such as its user agent and the page you came from. You
                don't have to provide this data, but without it the site can't be shown to you.
            </p>
            <p>
                Requests that our Worker handles (overlay pages, connections to the chat relay,
                requests to the cache, redirects and error pages) are also logged, including the IP
                address, the approximate location Cloudflare derives from it, and the address
                requested. The address of an overlay names its Twitch channel and carries the
                settings of its link, among them the accounts it is told to hide. Chat messages are
                never logged. We use these logs only to fix errors and to prevent abuse, and they
                are deleted after at most 7 days.
            </p>
            <p>
                To prevent abuse, the Worker also counts the requests of an IP address over one
                minute and refuses requests above a limit; the count is held only in the memory of
                Cloudflare's rate limiter. Overlay pages, the relay and the cache are meant for
                browsers and streaming software: the Worker reads the user agent of a request and
                refuses crawlers and scripts there. To operate the relay we count technical events,
                such as connections, relayed messages and the cache's answers by kind. These counts
                are kept in Cloudflare Workers Analytics Engine and contain no IP addresses,
                channels or user names and nothing of what a message says.
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

            <h2>Start page</h2>
            <p>
                The start page puts your overlay link together in your browser, from the channel and
                the settings you choose. The preview on the page is an overlay page in demo mode,
                loaded from our Worker: it shows sample messages and opens no chat connection. Its
                badges and emotes are the real ones, so your browser loads their images from Twitch,
                7TV and BetterTTV and, with Homies badges switched on, from the Homies hosts, as it
                would for any overlay page (see "Chat overlay"). Its address carries your settings
                but not the channel you typed, and the request for it is logged like that of any
                overlay page (see "Hosting"). Apart from that preview, the start page loads nothing
                from third parties.
            </p>

            <h2>Theme</h2>
            <p>
                The start page and the legal pages follow the light or dark setting of your device.
                If you pick a theme with the button in the header, your browser keeps the choice
                (system, light or dark) in its local storage under the name "theme", so that the
                pages open in that theme the next time. Nothing is stored before you use the button.
                The value is not a cookie, stays in your browser and is never transmitted to us or
                to anyone else; you can remove it by deleting the site data in your browser. Storing
                it is strictly necessary for the function you asked for (§ 25(2) no. 2 TDDDG).
            </p>

            <h2>Chat overlay</h2>
            <p>
                An overlay page (/chat/…) runs in your browser or in OBS and shows the chat of the
                channel in its address along with its emotes, badges and name paints. You don't sign
                in, and Petal never sees any Twitch credentials.
            </p>
            <p>
                The chat reaches the overlay through our relay: a Cloudflare Worker and Durable
                Objects that Cloudflare runs on our behalf. The relay reads the chat of the channel
                from Twitch over an anonymous, read-only connection and passes it on to the overlay.
                Twitch doesn't receive your IP address for this. What the relay does with chat
                messages is described in the next section.
            </p>
            <p>
                Our Worker also fetches the lists of emotes, badges and name paints from the
                services below and keeps their answers in a cache at Cloudflare (Workers KV) for up
                to 31 days. These requests name the Twitch channel but contain nothing about you, so
                the services don't receive your IP address for them either.
            </p>
            <p>
                Your browser still connects directly to the services below to load the images of
                emotes, badges and name paints, and to 7TV, BetterTTV and FrankerFaceZ to receive
                live updates, which tell the overlay about changed emotes, badges and name paints
                while it runs. As a fallback, when our relay or our cache can't be reached or when
                the address of the overlay contains direct=1, your browser also connects directly to
                Twitch chat, anonymously and read-only, and fetches the lists from the services
                itself. For direct connections the services receive your IP address and browser
                details, and for live updates and in the fallback most of them the Twitch channel.
            </p>
            <OverlayServices lang="en" />
            <p>
                Badges of Chatterino Homies are switched off unless the address of the overlay
                contains homies=1. Only then does your browser load the lists of these badges from
                chatterinohomies.com and itzalex.github.io and their images from
                cdn.chatterinohomies.com and itzalex.github.io. The lists are requested whole and
                without cookies; the requests name neither the Twitch channel nor anyone who chats.
                itzalex.github.io is hosted by GitHub, Inc., USA.
            </p>
            <p>
                The legal basis is our legitimate interest in showing the chat you open, which needs
                the relay, the cache and these connections (Art. 6(1)(f) GDPR). Each service
                processes the data it receives under its own responsibility. Twitch, BetterTTV and
                FrankerFaceZ are based in the USA and aren't certified under the EU-U.S. Data
                Privacy Framework, and not every other service says where it is based. Where no
                adequacy decision applies, the transfer is necessary to provide the overlay you
                requested (Art. 49(1)(b) GDPR).
            </p>

            <h2>If you chat in a channel that uses Petal</h2>
            <p>
                The overlay shows chat messages on stream with display name, color and badges, as
                Twitch delivers them, unless the streamer's link hides names or badges. On their way
                from Twitch to the overlay, the messages of the channel shown pass through our relay
                at Cloudflare. The relay holds them in memory only: it passes each message on and
                keeps the latest 50 messages of a channel for overlays that connect later, until
                newer messages replace them or until about a minute after the last overlay that
                shows the channel has closed. It doesn't store, log or analyze chat messages. In the
                fallback described under "Chat overlay", the messages go from Twitch straight to the
                browser that runs the overlay.
            </p>
            <p>
                The overlay itself keeps the latest 100 messages in memory and forgets them when
                it's closed. Messages deleted by moderators, and messages from accounts that get
                timed out or banned, disappear from the relay's memory and from the overlay as well.
                Whether chat appears on a stream is up to the streamer.
            </p>
            <p>
                We receive these messages from Twitch, not from you. The legal basis is our
                legitimate interest, and the streamer's, in showing the public chat of a channel on
                its stream (Art. 6(1)(f) GDPR). Cloudflare processes them as our processor, as
                described under "Hosting".
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
