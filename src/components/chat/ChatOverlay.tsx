import "./overlay.css";

import { For } from "solid-js";

import type { ChatSession } from "~/lib/chat/session";

import styles from "./Chat.module.css";
import ChatLine, { BADGE_HEIGHT } from "./ChatLine";
import { EMOTE_HEIGHT } from "./EmoteView";
import { BTTVEffectFilters } from "./Username";

export default function ChatOverlay(props: { session: ChatSession }) {
    return (
        <div
            class={styles.overlay}
            data-status={props.session.state.status}
            style={{ "--emote-height": `${EMOTE_HEIGHT}px`, "--badge-height": `${BADGE_HEIGHT}px` }}
        >
            <BTTVEffectFilters />
            <For each={props.session.state.messages}>
                {(message) => <ChatLine session={props.session} message={message} />}
            </For>
        </div>
    );
}
