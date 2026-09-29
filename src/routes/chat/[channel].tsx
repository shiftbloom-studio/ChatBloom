import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import ChatOverlay from "~/components/chat/ChatOverlay";
import MySiteTitle from "~/components/MySiteTitle";
import { createDemoSession, DEMO_HOMIES_BADGES, isDemo } from "~/lib/chat/demo";
import { fetchHomiesBadges, type HomiesBadges } from "~/lib/chat/providers/homies";
import { type ChatSession, createChatSession } from "~/lib/chat/session";
import { parseSettings } from "~/lib/overlay/settings";

export default function Chat() {
    const params = useParams<{ channel: string }>();
    const location = useLocation();
    const query = createMemo(() => new URLSearchParams(location.search));
    const settings = createMemo(() => parseSettings(query()));
    // A memo, so that other parameters can change without the chat starting over.
    const demo = createMemo(() => isDemo(query()));
    // Badges that are switched off need no lists either.
    const homiesShown = createMemo(() => settings().homies && settings().badges);
    const [session, setSession] = createSignal<ChatSession>();
    const [homies, setHomies] = createSignal<HomiesBadges>();

    onMount(() => {
        // Lets overlay.css make the page transparent for OBS browser sources.
        document.documentElement.dataset.chatOverlay = "";
        onCleanup(() => delete document.documentElement.dataset.chatOverlay);
    });

    // Effects only run in the browser, which is the only place the sockets can live.
    createEffect(() => {
        const chat = demo() ? createDemoSession() : createChatSession(params.channel);
        setSession(chat);
        onCleanup(() => chat.dispose());
    });

    // Apart from the session, so the chat neither waits for the lists of Homies nor notices
    // when they fail to load. Only links that ask for the badges request them.
    createEffect(() => {
        if (!homiesShown()) return;
        if (demo()) {
            setHomies(DEMO_HOMIES_BADGES);
        } else {
            let wanted = true;
            fetchHomiesBadges().then((badges) => wanted && setHomies(badges));
            onCleanup(() => {
                wanted = false;
            });
        }
        onCleanup(() => setHomies(undefined));
    });

    return (
        <>
            <MySiteTitle>{`#${params.channel}`}</MySiteTitle>
            <Show when={session()}>
                {(chat) => <ChatOverlay session={chat()} settings={settings()} homies={homies()} />}
            </Show>
        </>
    );
}
