import { useParams } from "@solidjs/router";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";

import ChatOverlay from "~/components/chat/ChatOverlay";
import MySiteTitle from "~/components/MySiteTitle";
import { type ChatSession, createChatSession } from "~/lib/chat/session";

export default function Chat() {
    const params = useParams<{ channel: string }>();
    const [session, setSession] = createSignal<ChatSession>();

    onMount(() => {
        // Lets overlay.css make the page transparent for OBS browser sources.
        document.documentElement.dataset.chatOverlay = "";
        onCleanup(() => delete document.documentElement.dataset.chatOverlay);
    });

    // Effects only run in the browser, which is the only place the sockets can live.
    createEffect(() => {
        const chat = createChatSession(params.channel);
        setSession(chat);
        onCleanup(() => chat.dispose());
    });

    return (
        <>
            <MySiteTitle>{`#${params.channel}`}</MySiteTitle>
            <Show when={session()}>{(chat) => <ChatOverlay session={chat()} />}</Show>
        </>
    );
}
