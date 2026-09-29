import LegalPage from "~/components/legal/LegalPage";
import OperatorAddress, { operator } from "~/components/legal/OperatorAddress";
import OverlayServices from "~/components/legal/OverlayServices";

// Keep in step with the English version, privacy.tsx, which says when both need updating.
export default function Datenschutz() {
    return (
        <LegalPage
            lang="de"
            title="Datenschutzerklärung"
            translation="/privacy"
            updated="Stand: 29. September 2026"
        >
            <p>
                ChatBloom hat keine Benutzerkonten und nutzt weder Cookies noch den lokalen Speicher
                deines Browsers. Es verwendet keine Analyse-, Tracking- oder Werbedienste und trifft
                keine automatisierten Entscheidungen über dich. Diese Erklärung beschreibt, welche
                personenbezogenen Daten trotzdem verarbeitet werden, wenn du chat.shiftbloom.studio
                nutzt, vor allem deine IP-Adresse.
            </p>

            <h2>Verantwortlicher</h2>
            <OperatorAddress lang="de" />
            <p>
                E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
            </p>

            <h2>Hosting</h2>
            <p>
                Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, liefert in unserem
                Auftrag alle Seiten und Dateien von ChatBloom aus, auch die Schriften. Dazu
                verarbeitet Cloudflare deine IP-Adresse, die Adresse der aufgerufenen Seite, den
                Zeitpunkt und Angaben, die dein Browser mitsendet, etwa den User-Agent und die
                Seite, von der du kommst. Du musst diese Daten nicht bereitstellen, ohne sie kann
                die Website aber nicht angezeigt werden.
            </p>
            <p>
                Anfragen, die unser Worker bearbeitet (Overlay-Seiten, Weiterleitungen und
                Fehlerseiten), werden zusätzlich protokolliert, samt IP-Adresse und dem ungefähren
                Standort, den Cloudflare daraus ableitet. Wir nutzen diese Protokolle nur, um Fehler
                zu beheben und Missbrauch zu verhindern; sie werden nach spätestens 7 Tagen
                gelöscht.
            </p>
            <p>
                Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und zuverlässigen
                Betrieb von ChatBloom (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare verarbeitet die Daten
                als unser Auftragsverarbeiter auf Grundlage eines Auftragsverarbeitungsvertrags
                (Art. 28 DSGVO). Cloudflare, Inc. ist nach dem EU-U.S. Data Privacy Framework
                zertifiziert, für das ein Angemessenheitsbeschluss der Europäischen Kommission
                besteht (Art. 45 DSGVO); der Vertrag enthält zusätzlich die
                EU-Standardvertragsklauseln. Mehr dazu in der{" "}
                <a href="https://www.cloudflare.com/de-de/privacypolicy/">
                    Datenschutzerklärung von Cloudflare
                </a>
                .
            </p>

            <h2>Chat-Overlay</h2>
            <p>
                Eine Overlay-Seite (/v3/chat/…) läuft in deinem Browser oder in OBS und verbindet
                ihn direkt mit den folgenden Diensten, um den Chat des angezeigten Kanals samt
                Emotes, Badges und Name-Paints zu laden. Die Dienste erhalten deine IP-Adresse und
                Browserangaben, die meisten auch den Twitch-Kanal. Die Verbindung zum Twitch-Chat
                ist anonym und nur lesend: Du meldest dich nicht an, und ChatBloom sieht keine
                Twitch-Zugangsdaten.
            </p>
            <OverlayServices lang="de" />
            <p>
                Rechtsgrundlage ist unser berechtigtes Interesse, den Chat anzuzeigen, den du
                aufrufst; dafür sind diese Verbindungen nötig (Art. 6 Abs. 1 lit. f DSGVO). Jeder
                Dienst verarbeitet die Daten in eigener Verantwortung. Twitch, BetterTTV und
                FrankerFaceZ sitzen in den USA und sind nicht nach dem EU-U.S. Data Privacy
                Framework zertifiziert; nicht alle anderen Dienste geben an, wo sie sitzen. Soweit
                kein Angemessenheitsbeschluss greift, ist die Übermittlung für das von dir
                angeforderte Overlay erforderlich (Art. 49 Abs. 1 lit. b DSGVO).
            </p>

            <h2>Wenn du in einem Kanal mit ChatBloom chattest</h2>
            <p>
                Das Overlay zeigt Chatnachrichten samt Anzeigename, Farbe und Badges im Stream, so
                wie Twitch sie liefert. Das geschieht nur in dem Browser, in dem das Overlay läuft:
                Die Server von ChatBloom erhalten keine Chatnachrichten. Das Overlay behält die
                letzten 100 Nachrichten im Arbeitsspeicher und vergisst sie, sobald es geschlossen
                wird. Von Moderatoren gelöschte Nachrichten und Nachrichten von Accounts, die
                zeitweise oder dauerhaft gesperrt werden, verschwinden auch aus dem Overlay. Ob der
                Chat im Stream erscheint, entscheidet, wer streamt.
            </p>

            <h2>E-Mail</h2>
            <p>
                Wenn du uns schreibst, nutzen wir deine Adresse und Nachricht nur, um dir zu
                antworten (Art. 6 Abs. 1 lit. f DSGVO), und löschen sie, sobald die Sache erledigt
                ist, es sei denn, das Gesetz verpflichtet uns zur Aufbewahrung.
            </p>

            <h2>Deine Rechte</h2>
            <p>
                Du hast das Recht auf Auskunft über deine personenbezogenen Daten (Art. 15 DSGVO),
                auf Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art.
                18) und Datenübertragbarkeit (Art. 20). Schreib uns dazu eine E-Mail. Außerdem
                kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO),
                etwa bei der an deinem Wohnort oder bei der für uns zuständigen: Unabhängiges
                Landeszentrum für Datenschutz Schleswig-Holstein, Postfach 71 16, 24171 Kiel.
            </p>

            <h2>Widerspruchsrecht</h2>
            <p>
                <strong>
                    Du kannst der Verarbeitung deiner personenbezogenen Daten auf Grundlage von Art.
                    6 Abs. 1 lit. f DSGVO jederzeit aus Gründen widersprechen, die sich aus deiner
                    besonderen Situation ergeben (Art. 21 DSGVO).
                </strong>
            </p>
        </LegalPage>
    );
}
