import { createMemo, For, Show } from "solid-js";

import type { ChatMessage, ChatSession } from "~/lib/chat/session";
import type { Badge } from "~/lib/chat/types";

import styles from "./Chat.module.css";
import EmoteView, { sizedSrcset } from "./EmoteView";
import Username from "./Username";

export const BADGE_HEIGHT = 22;

function BadgeImage(props: { badge: Badge }) {
    return (
        <img
            class={styles.badge}
            srcset={sizedSrcset(props.badge.images, 18)}
            sizes={`${BADGE_HEIGHT}px`}
            alt={props.badge.title}
            title={props.badge.title}
            style={{ "background-color": props.badge.background }}
        />
    );
}

export default function ChatLine(props: { session: ChatSession; message: ChatMessage }) {
    const parts = createMemo(() => props.session.parts(props.message));
    const badges = createMemo(() => props.session.badges(props.message));
    const user = () => props.session.user(props.message);

    return (
        <div class={styles.line}>
            <Show when={props.message.system}>
                <div class={styles.system}>{props.message.system}</div>
            </Show>
            <Show when={props.message.text}>
                <span class={styles.badges}>
                    <For each={badges()}>{(badge) => <BadgeImage badge={badge} />}</For>
                </span>
                <Username
                    name={props.message.displayName}
                    color={props.message.color}
                    paint={props.session.paint(props.message)}
                    effect={user()?.bttvEffect}
                />
                {props.message.action ? " " : ": "}
                <span
                    classList={{ [styles.action]: props.message.action }}
                    style={{ color: props.message.action ? props.message.color : undefined }}
                >
                    <For each={parts()}>
                        {(part) => {
                            if (part.type === "text") return part.text;
                            if (part.type === "mention") {
                                return <span class={styles.mention}>{part.text}</span>;
                            }
                            return <EmoteView part={part} />;
                        }}
                    </For>
                </span>
            </Show>
        </div>
    );
}
