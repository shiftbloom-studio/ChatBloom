import "./overlay.css";

import { createMemo, For } from "solid-js";

import type { HomiesBadges } from "~/lib/chat/providers/homies";
import type { ChatSession } from "~/lib/chat/session";
import { emoteScale, fontFamily, textScale } from "~/lib/overlay/look";
import { DEFAULT_SETTINGS, isMessageShown, type OverlaySettings } from "~/lib/overlay/settings";

import styles from "./Chat.module.css";
import ChatLine, { BADGE_HEIGHT } from "./ChatLine";
import { EMOTE_HEIGHT } from "./EmoteView";
import { SettingsProvider } from "./settings";
import { BTTVEffectFilters } from "./Username";

export default function ChatOverlay(props: {
    session: ChatSession;
    settings?: OverlaySettings;
    /** Shown after the badges of the session, for links that ask for Homies badges. */
    homies?: HomiesBadges;
}) {
    const settings = () => props.settings ?? DEFAULT_SETTINGS;
    // Filtered here and not in the session, so the session stays the plain record of the chat.
    const messages = createMemo(() =>
        props.session.state.messages.filter((message) => isMessageShown(message, settings())),
    );

    return (
        <SettingsProvider value={settings}>
            <div
                class={styles.overlay}
                data-status={props.session.state.status}
                data-stroke={settings().stroke}
                data-shadow={settings().shadow}
                data-emotes={settings().emotes}
                data-animate={Number(settings().animate)}
                data-fade={settings().fade}
                data-caps={Number(settings().caps)}
                data-newline={Number(settings().newline)}
                style={{
                    "--chat-scale": textScale(settings()),
                    "--chat-font": fontFamily(settings()),
                    "--chat-fade": `${settings().fade}s`,
                    "--emote-height": `${EMOTE_HEIGHT * emoteScale(settings())}px`,
                    "--badge-height": `${BADGE_HEIGHT * textScale(settings())}px`,
                }}
            >
                <BTTVEffectFilters />
                <For each={messages()}>
                    {(message) => (
                        <ChatLine
                            session={props.session}
                            message={message}
                            homies={props.homies?.get(message.userId)}
                        />
                    )}
                </For>
            </div>
        </SettingsProvider>
    );
}
