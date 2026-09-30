import "./overlay.css";

import { createMemo, For, Show } from "solid-js";

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
    /** The chat to show; none where there is nothing to connect to, and only a notice. */
    session?: ChatSession;
    settings?: OverlaySettings;
    /** Shown after the badges of the session, for links that ask for Homies badges. */
    homies?: HomiesBadges;
    /**
     * Why the chat stays empty, such as a link that names no channel or a channel that Twitch
     * refuses. Shown as a line of its own below the chat, signed "Petal:", so that nobody takes
     * it for a message from the chat.
     */
    notice?: string;
}) {
    const settings = () => props.settings ?? DEFAULT_SETTINGS;
    // Filtered here and not in the session, so the session stays the plain record of the chat.
    const messages = createMemo(() =>
        (props.session?.state.messages ?? []).filter((message) =>
            isMessageShown(message, settings()),
        ),
    );

    return (
        <SettingsProvider value={settings}>
            <div
                class={styles.overlay}
                data-status={props.session?.state.status}
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
                <Show when={props.session}>
                    {(session) => (
                        <For each={messages()}>
                            {(message) => (
                                <ChatLine
                                    session={session()}
                                    message={message}
                                    homies={props.homies?.get(message.userId)}
                                />
                            )}
                        </For>
                    )}
                </Show>
                <Show when={props.notice}>
                    {(notice) => (
                        <p class={styles.notice} role="status">
                            <span class={styles.noticeFrom}>Petal:</span> {notice()}
                        </p>
                    )}
                </Show>
            </div>
        </SettingsProvider>
    );
}
