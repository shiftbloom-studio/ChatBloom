import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import ChatOverlay from "~/components/chat/ChatOverlay";
import MySiteTitle from "~/components/MySiteTitle";
import { PREVIEW_CHANNEL } from "~/components/setup/link";
import { readChannelSegment } from "~/lib/channel";
import { createDemoSession, DEMO_HOMIES_BADGES, isDemo } from "~/lib/chat/demo";
import { fetchHomiesBadges, type HomiesBadges } from "~/lib/chat/providers/homies";
import { type ChatSession, createChatSession } from "~/lib/chat/session";
import { parseSettings } from "~/lib/overlay/settings";

export default function Chat() {
    const params = useParams<{ channel: string }>();
    // The router leaves the segment percent-encoded, as it stands in the address.
    const channel = createMemo(() => readChannelSegment(params.channel));
    // Apart, so that "/chat/Forsen" and "/chat/forsen" do not start the chat over.
    const login = createMemo(() => channel().login);
    const location = useLocation();
    const query = createMemo(() => new URLSearchParams(location.search));
    const settings = createMemo(() => parseSettings(query()));
    // A memo, so that other parameters can change without the chat starting over.
    const demo = createMemo(() => isDemo(query()));
    // Badges that are switched off need no lists either.
    const homiesShown = createMemo(() => settings().homies && settings().badges);
    const [session, setSession] = createSignal<ChatSession>();
    const [homies, setHomies] = createSignal<HomiesBadges>();
    // Computed on the server as well, so that the notice about the name is in the page from the
    // start. Twitch's word on the channel comes later, over the connection, and it is the only
    // sign in the scene of a link that names a channel nobody can watch.
    const notice = createMemo(() => {
        if (demo()) return undefined;
        const name = login();
        if (!name) return `“${channel().text}” is not a Twitch channel name.`;
        if (session()?.state.status === "unavailable") {
            return `twitch.tv/${name} does not exist or is suspended.`;
        }
        return undefined;
    });

    onMount(() => {
        // Lets overlay.css make the page transparent for OBS browser sources.
        document.documentElement.dataset.chatOverlay = "";
        onCleanup(() => delete document.documentElement.dataset.chatOverlay);
    });

    // Effects only run in the browser, which is the only place the sockets can live.
    createEffect(() => {
        const name = login();
        // A name that Twitch cannot have gets no connection at all, only the notice. Joined as
        // it stands, "a,b" would join two channels, and "%C3%A9" would wait for chat forever.
        const chat = demo()
            ? createDemoSession({ channel: name === PREVIEW_CHANNEL ? undefined : name })
            : name
              ? createChatSession(name)
              : undefined;
        setSession(chat);
        if (chat) onCleanup(() => chat.dispose());
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
            <MySiteTitle>{`#${login() ?? channel().text}`}</MySiteTitle>
            <Show when={session() || notice()}>
                <ChatOverlay
                    session={session()}
                    settings={settings()}
                    homies={homies()}
                    notice={notice()}
                />
            </Show>
        </>
    );
}
