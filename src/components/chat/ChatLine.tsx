import { createMemo, createSignal, For, Show } from "solid-js";

import type { HomiesBadge } from "~/lib/chat/providers/homies";
import type { ChatMessage, ChatSession } from "~/lib/chat/session";
import type { Badge } from "~/lib/chat/types";
import { textScale } from "~/lib/overlay/look";

import styles from "./Chat.module.css";
import EmoteView, { ChatImage } from "./EmoteView";
import { useSettings } from "./settings";
import Username from "./Username";

export const BADGE_HEIGHT = 22;

/** A badge whose image cannot be loaded is left out: its title as text would read as a name. */
function BadgeImage(props: { badge: Badge | HomiesBadge }) {
    const settings = useSettings();
    const [failed, setFailed] = createSignal(false);
    return (
        <Show when={!failed()}>
            <ChatImage
                class={styles.badge}
                images={props.badge.images}
                baseHeight={18}
                sizes={`${BADGE_HEIGHT * textScale(settings())}px`}
                alt={props.badge.title}
                style={{ "background-color": props.badge.background }}
                onFail={() => setFailed(true)}
            />
        </Show>
    );
}

export default function ChatLine(props: {
    session: ChatSession;
    message: ChatMessage;
    /** The Homies badges of the chatter, where the overlay has loaded them. */
    homies?: readonly HomiesBadge[];
}) {
    const settings = useSettings();
    const parts = createMemo(() => props.session.parts(props.message));
    const badges = createMemo((): (Badge | HomiesBadge)[] => {
        if (!settings().badges) return [];
        const homies = settings().homies ? (props.homies ?? []) : [];
        return [...props.session.badges(props.message), ...homies];
    });
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
                <Show when={settings().names}>
                    <Username
                        name={props.message.displayName}
                        color={props.message.color}
                        paint={props.session.paint(props.message)}
                        effect={user()?.bttvEffect}
                    />
                    {props.message.action ? " " : ": "}
                </Show>
                <span
                    classList={{
                        [styles.message]: true,
                        [styles.action]: props.message.action,
                    }}
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
