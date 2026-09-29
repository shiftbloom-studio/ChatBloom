import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";

import { copyText } from "~/components/setup/clipboard";
import type { Setup } from "~/components/setup/store";
import { parseChannel } from "~/lib/channel";
import styles from "./OverlayLink.module.css";

/** The channel field of the page, for links that lead to it. */
export const CHANNEL_FIELD = "channel";

// The page's one job: a channel goes in, an OBS browser-source link comes out, wearing the
// look chosen in the section below. Nothing leaves the browser, and nothing is stored.
//
// One step at a time: an empty field shows the field and nothing of what follows. The link
// and the way on to the look appear once there is a channel, the way to OBS once the link
// has been copied.
export default function OverlayLink(props: { setup: Setup }) {
    const [copied, setCopied] = createSignal(false);
    const [invalid, setInvalid] = createSignal(false);
    let field: HTMLInputElement | undefined;
    let preview: HTMLAnchorElement | undefined;
    let reset: ReturnType<typeof setTimeout> | undefined;

    onCleanup(() => clearTimeout(reset));

    const url = () => props.setup.url();

    // A link that has changed is no longer the one on the clipboard.
    createEffect(on(url, () => setCopied(false), { defer: true }));

    async function copy(event: SubmitEvent) {
        event.preventDefault();
        const link = url();
        if (!link) {
            setInvalid(props.setup.channelText().trim() !== "");
            field?.focus();
            return;
        }
        if (!(await copyText(link))) {
            // No clipboard (plain http, old browser): select the link for a manual copy.
            if (preview) getSelection()?.selectAllChildren(preview);
            return;
        }
        setCopied(true);
        clearTimeout(reset);
        reset = setTimeout(() => setCopied(false), 2400);
    }

    return (
        <form class={styles.form} onSubmit={copy} autocomplete="off" novalidate>
            <div class={styles.row}>
                <label class={styles.field} classList={{ [styles.invalid]: invalid() }}>
                    <span class={styles.prefix} aria-hidden="true">
                        twitch.tv/
                    </span>
                    <input
                        ref={field}
                        id={CHANNEL_FIELD}
                        class={styles.input}
                        name="channel"
                        aria-label="Your Twitch channel"
                        aria-invalid={invalid()}
                        aria-describedby="overlay-hint"
                        placeholder="yourchannel"
                        autocomplete="off"
                        autocapitalize="none"
                        spellcheck={false}
                        enterkeyhint="done"
                        value={props.setup.channelText()}
                        onInput={(event) => {
                            // A pasted twitch.tv link collapses to its channel name.
                            const value = event.currentTarget.value;
                            const pasted = value.includes("/") ? parseChannel(value) : undefined;
                            if (pasted) event.currentTarget.value = pasted;
                            props.setup.setChannelText(pasted ?? value);
                            setInvalid(false);
                        }}
                    />
                </label>
                <button type="submit" class={styles.copy}>
                    {copied() ? "Copied" : "Copy overlay URL"}
                </button>
            </div>
            <p id="overlay-hint" class={styles.hint} aria-live="polite">
                <Show
                    when={!invalid()}
                    fallback={
                        <span class={styles.error}>
                            Channel names use letters, numbers and underscores.
                        </span>
                    }
                >
                    <Show when={url()} fallback="No account, no login.">
                        <Show
                            when={copied()}
                            fallback={
                                <a
                                    ref={preview}
                                    class={styles.url}
                                    href={url()}
                                    target="_blank"
                                    rel="noopener"
                                >
                                    {url()}
                                </a>
                            }
                        >
                            Copied. Now add it to OBS as a browser source.
                        </Show>
                    </Show>
                </Show>
            </p>
            <p class={styles.next} classList={{ [styles.waiting]: !url() }}>
                <a class="seed-link" href="#setup">
                    Choose the look
                </a>
            </p>
        </form>
    );
}
