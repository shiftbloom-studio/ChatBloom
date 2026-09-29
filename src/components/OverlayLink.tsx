import { createSignal, onCleanup, onMount, Show } from "solid-js";

import { parseChannel } from "~/lib/channel";
import styles from "./OverlayLink.module.css";

// The page's one job: a channel goes in, an OBS browser-source URL comes out.
// Nothing leaves the browser, and nothing is stored.
export default function OverlayLink() {
    const [input, setInput] = createSignal("");
    const [copied, setCopied] = createSignal(false);
    const [invalid, setInvalid] = createSignal(false);
    const [origin, setOrigin] = createSignal("https://chat.shiftbloom.studio");
    let field: HTMLInputElement | undefined;
    let preview: HTMLAnchorElement | undefined;
    let reset: ReturnType<typeof setTimeout> | undefined;

    onMount(() => setOrigin(location.origin));
    onCleanup(() => clearTimeout(reset));

    const channel = () => parseChannel(input());
    const url = () => `${origin()}/v3/chat/${channel()}`;

    async function copy(event: SubmitEvent) {
        event.preventDefault();
        if (!channel()) {
            setInvalid(input().trim() !== "");
            field?.focus();
            return;
        }
        try {
            await navigator.clipboard.writeText(url());
        } catch {
            // No clipboard (plain http, old browser): select the URL for a manual copy.
            if (preview) getSelection()?.selectAllChildren(preview);
            return;
        }
        setCopied(true);
        clearTimeout(reset);
        reset = setTimeout(() => setCopied(false), 2400);
    }

    return (
        <form class={styles.form} onSubmit={copy} novalidate>
            <div class={styles.row}>
                <label class={styles.field} classList={{ [styles.invalid]: invalid() }}>
                    <span class={styles.prefix} aria-hidden="true">
                        twitch.tv/
                    </span>
                    <input
                        ref={field}
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
                        value={input()}
                        onInput={(event) => {
                            // A pasted twitch.tv link collapses to its channel name.
                            const value = event.currentTarget.value;
                            const pasted = value.includes("/") ? parseChannel(value) : undefined;
                            if (pasted) event.currentTarget.value = pasted;
                            setInput(pasted ?? value);
                            setInvalid(false);
                            setCopied(false);
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
                    <Show when={channel()} fallback="Then add it to OBS as a browser source.">
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
        </form>
    );
}
