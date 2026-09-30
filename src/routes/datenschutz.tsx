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
            updated="Stand: 30. September 2026"
        >
            <p>
                Petal hat keine Benutzerkonten und setzt keine Cookies. Es verwendet keine Tracking-
                oder Werbedienste, wertet weder Besucher noch ihr Verhalten aus und trifft keine
                automatisierten Entscheidungen über dich. In deinem Browser speichert Petal nur
                deine Wahl des Farbschemas, und erst, wenn du eine triffst (siehe „Farbschema“).
                Diese Erklärung beschreibt, welche personenbezogenen Daten trotzdem verarbeitet
                werden, wenn du petal.shiftbloom.studio oder chat.shiftbloom.studio nutzt, vor allem
                deine IP-Adresse.
            </p>

            <h2>Verantwortlicher</h2>
            <OperatorAddress lang="de" />
            <p>
                E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
            </p>

            <h2>Hosting</h2>
            <p>
                Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, liefert in unserem
                Auftrag alle Seiten und Dateien von Petal aus, auch die Schriften, und betreibt
                unser Chat-Relay und unseren Zwischenspeicher für Emote- und Badge-Daten (siehe
                „Chat-Overlay“). Dazu verarbeitet Cloudflare deine IP-Adresse, die Adresse der
                aufgerufenen Seite, den Zeitpunkt und Angaben, die dein Browser mitsendet, etwa den
                User-Agent und die Seite, von der du kommst. Du musst diese Daten nicht
                bereitstellen, ohne sie kann die Website aber nicht angezeigt werden.
            </p>
            <p>
                Anfragen, die unser Worker bearbeitet (Overlay-Seiten, Verbindungen zum Chat-Relay,
                Abrufe aus dem Zwischenspeicher, Weiterleitungen und Fehlerseiten), werden
                zusätzlich protokolliert, samt IP-Adresse, dem ungefähren Standort, den Cloudflare
                daraus ableitet, und der aufgerufenen Adresse. Die Adresse eines Overlays nennt den
                Twitch-Kanal und enthält die Einstellungen des Links, darunter die Accounts, die es
                ausblenden soll. Chatnachrichten werden nie protokolliert. Wir nutzen diese
                Protokolle nur, um Fehler zu beheben und Missbrauch zu verhindern; sie werden nach
                spätestens 7 Tagen gelöscht.
            </p>
            <p>
                Um Missbrauch zu verhindern, zählt der Worker außerdem die Anfragen einer IP-Adresse
                über eine Minute und weist Anfragen oberhalb einer Grenze ab; die Zählung liegt nur
                im Arbeitsspeicher von Cloudflares Rate-Limiter. Overlay-Seiten, das Relay und der
                Zwischenspeicher sind für Browser und Streaming-Software gedacht: Der Worker liest
                den User-Agent einer Anfrage und weist Crawler und Skripte dort ab. Für den Betrieb
                des Relays zählen wir technische Ereignisse, etwa Verbindungen, weitergereichte
                Nachrichten und die Antworten des Zwischenspeichers nach Art. Diese Zählungen liegen
                in der Cloudflare Workers Analytics Engine und enthalten keine IP-Adressen, Kanäle
                oder Benutzernamen und nichts vom Inhalt einer Nachricht.
            </p>
            <p>
                Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und zuverlässigen
                Betrieb von Petal (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare verarbeitet die Daten als
                unser Auftragsverarbeiter auf Grundlage eines Auftragsverarbeitungsvertrags (Art. 28
                DSGVO). Cloudflare, Inc. ist nach dem EU-U.S. Data Privacy Framework zertifiziert,
                für das ein Angemessenheitsbeschluss der Europäischen Kommission besteht (Art. 45
                DSGVO); der Vertrag enthält zusätzlich die EU-Standardvertragsklauseln. Mehr dazu in
                der{" "}
                <a href="https://www.cloudflare.com/de-de/privacypolicy/">
                    Datenschutzerklärung von Cloudflare
                </a>
                .
            </p>

            <h2>Startseite</h2>
            <p>
                Die Startseite setzt deinen Overlay-Link in deinem Browser zusammen, aus dem Kanal
                und den Einstellungen, die du wählst. Die Vorschau auf der Seite ist eine
                Overlay-Seite im Demo-Modus, die von unserem Worker geladen wird: Sie zeigt
                Beispielnachrichten und verbindet sich weder mit Twitch noch mit den unter
                „Chat-Overlay“ genannten Diensten. Ihre Adresse enthält deine Einstellungen, aber
                nicht den eingegebenen Kanal, und ihr Abruf wird wie der jeder Overlay-Seite
                protokolliert (siehe „Hosting“). Die Startseite lädt nichts von Dritten.
            </p>

            <h2>Farbschema</h2>
            <p>
                Die Startseite und die rechtlichen Seiten folgen der Hell-Dunkel-Einstellung deines
                Geräts. Wählst du mit dem Knopf in der Kopfzeile ein Farbschema, behält dein Browser
                die Wahl (System, hell oder dunkel) in seinem lokalen Speicher unter dem Namen
                „theme“, damit die Seiten beim nächsten Mal in diesem Schema erscheinen. Vorher wird
                nichts gespeichert. Der Wert ist kein Cookie, bleibt in deinem Browser und wird
                weder an uns noch an andere übertragen; du kannst ihn entfernen, indem du die
                Websitedaten in deinem Browser löschst. Das Speichern ist unbedingt erforderlich, um
                die von dir gewünschte Funktion bereitzustellen (§ 25 Abs. 2 Nr. 2 TDDDG).
            </p>

            <h2>Chat-Overlay</h2>
            <p>
                Eine Overlay-Seite (/chat/…) läuft in deinem Browser oder in OBS und zeigt den Chat
                des Kanals aus ihrer Adresse samt Emotes, Badges und Name-Paints. Du meldest dich
                nicht an, und Petal sieht keine Twitch-Zugangsdaten.
            </p>
            <p>
                Der Chat erreicht das Overlay über unser Relay: einen Cloudflare Worker und Durable
                Objects, die Cloudflare in unserem Auftrag betreibt. Das Relay liest den Chat des
                Kanals über eine anonyme, nur lesende Verbindung bei Twitch mit und reicht ihn an
                das Overlay weiter. Twitch erhält deine IP-Adresse dafür nicht. Was das Relay mit
                Chatnachrichten macht, steht im nächsten Abschnitt.
            </p>
            <p>
                Auch die Listen der Emotes, Badges und Name-Paints ruft unser Worker bei den
                folgenden Diensten ab und hält ihre Antworten bis zu 31 Tage in einem
                Zwischenspeicher bei Cloudflare (Workers KV) vor. Diese Abrufe nennen den
                Twitch-Kanal, enthalten aber nichts über dich; die Dienste erhalten deine IP-Adresse
                also auch dafür nicht.
            </p>
            <p>
                Direkt verbindet sich dein Browser weiterhin mit den folgenden Diensten, um die
                Bilder der Emotes, Badges und Name-Paints zu laden, und mit 7TV, BetterTTV und
                FrankerFaceZ, um Live-Aktualisierungen zu empfangen, die dem laufenden Overlay
                geänderte Emotes, Badges und Name-Paints melden. Ersatzweise, wenn unser Relay oder
                unser Zwischenspeicher nicht erreichbar ist oder die Adresse des Overlays direct=1
                enthält, verbindet sich dein Browser außerdem direkt mit dem Twitch-Chat, anonym und
                nur lesend, und ruft die Listen selbst bei den Diensten ab. Bei direkten
                Verbindungen erhalten die Dienste deine IP-Adresse und Browserangaben, bei
                Live-Aktualisierungen und im Ersatzfall die meisten auch den Twitch-Kanal.
            </p>
            <OverlayServices lang="de" />
            <p>
                Badges von Chatterino Homies sind ausgeschaltet, solange die Adresse des Overlays
                nicht homies=1 enthält. Nur dann lädt dein Browser die Listen dieser Badges von
                chatterinohomies.com und itzalex.github.io und ihre Bilder von
                cdn.chatterinohomies.com und itzalex.github.io. Die Listen werden vollständig und
                ohne Cookies abgerufen; die Abrufe nennen weder den Twitch-Kanal noch jemanden, der
                chattet. itzalex.github.io wird von GitHub, Inc., USA, gehostet.
            </p>
            <p>
                Rechtsgrundlage ist unser berechtigtes Interesse, den Chat anzuzeigen, den du
                aufrufst; dafür sind das Relay, der Zwischenspeicher und diese Verbindungen nötig
                (Art. 6 Abs. 1 lit. f DSGVO). Jeder Dienst verarbeitet die Daten, die er erhält, in
                eigener Verantwortung. Twitch, BetterTTV und FrankerFaceZ sitzen in den USA und sind
                nicht nach dem EU-U.S. Data Privacy Framework zertifiziert; nicht alle anderen
                Dienste geben an, wo sie sitzen. Soweit kein Angemessenheitsbeschluss greift, ist
                die Übermittlung für das von dir angeforderte Overlay erforderlich (Art. 49 Abs. 1
                lit. b DSGVO).
            </p>

            <h2>Wenn du in einem Kanal mit Petal chattest</h2>
            <p>
                Das Overlay zeigt Chatnachrichten samt Anzeigename, Farbe und Badges im Stream, so
                wie Twitch sie liefert, sofern der Link der Streamerin oder des Streamers Namen oder
                Badges nicht ausblendet. Auf dem Weg von Twitch zum Overlay laufen die Nachrichten
                des angezeigten Kanals durch unser Relay bei Cloudflare. Das Relay hält sie nur im
                Arbeitsspeicher: Es reicht jede Nachricht weiter und behält die letzten 50
                Nachrichten eines Kanals für Overlays, die sich später verbinden, bis neuere
                Nachrichten sie verdrängen oder bis etwa eine Minute, nachdem das letzte Overlay
                geschlossen wurde, das den Kanal anzeigt. Es speichert Chatnachrichten nicht,
                protokolliert sie nicht und wertet sie nicht aus. Im unter „Chat-Overlay“
                beschriebenen Ersatzfall gelangen die Nachrichten von Twitch unmittelbar in den
                Browser, in dem das Overlay läuft.
            </p>
            <p>
                Das Overlay selbst behält die letzten 100 Nachrichten im Arbeitsspeicher und
                vergisst sie, sobald es geschlossen wird. Von Moderatoren gelöschte Nachrichten und
                Nachrichten von Accounts, die zeitweise oder dauerhaft gesperrt werden, verschwinden
                auch aus dem Arbeitsspeicher des Relays und aus dem Overlay. Ob der Chat im Stream
                erscheint, entscheidet, wer streamt.
            </p>
            <p>
                Wir erhalten diese Nachrichten von Twitch, nicht von dir. Rechtsgrundlage ist unser
                berechtigtes Interesse und das der Streamerin oder des Streamers, den öffentlichen
                Chat eines Kanals in dessen Stream anzuzeigen (Art. 6 Abs. 1 lit. f DSGVO).
                Cloudflare verarbeitet sie als unser Auftragsverarbeiter, wie unter „Hosting“
                beschrieben.
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
