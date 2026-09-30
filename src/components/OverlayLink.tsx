import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js";

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
//
// The link under the field changes with every keystroke, so it is not announced: screen readers
// would read it out again and again. What is announced has its own line below it: the link was
// copied, the link could not be copied, the name is not a channel.
export default function OverlayLink(props: { setup: Setup }) {
    // What the button did last: copied the link, or selected it for a copy by hand.
    const [outcome, setOutcome] = createSignal<"copied" | "selected">();
    const [invalid, setInvalid] = createSignal(false);
    let field: HTMLInputElement | undefined;
    let preview: HTMLAnchorElement | undefined;
    let reset: ReturnType<typeof setTimeout> | undefined;

    onCleanup(() => clearTimeout(reset));

    const url = () => props.setup.url();

    // The field is described by what helps to fill it: the error, or the line under it while that
    // says there is no account. Never by the link, whose every change a screen reader would read
    // out as a new description of the field.
    const description = () => (invalid() ? "overlay-error" : url() ? undefined : "overlay-hint");

    // A link that has changed is no longer the one on the clipboard, nor the one selected.
    createEffect(
        on(
            url,
            () => {
                clearTimeout(reset);
                setOutcome(undefined);
            },
            { defer: true },
        ),
    );

    async function copy(event: SubmitEvent) {
        event.preventDefault();
        const link = url();
        if (!link) {
            setInvalid(props.setup.channelText().trim() !== "");
            field?.focus();
            return;
        }
        const copied = await copyText(link);
        // The field changed while the clipboard was busy: what happened was to a link that is gone.
        if (url() !== link) return;
        // No clipboard (plain http, a denied permission): the link, which is on the page whenever
        // there is one, is selected for a copy by hand, and the line below says how. The focus
        // goes along to the link: left in the field, it would type into a selection that is
        // no longer there, and every key would be lost.
        if (!copied && preview) {
            preview.focus();
            getSelection()?.selectAllChildren(preview);
        }
        setOutcome(copied ? "copied" : "selected");
        clearTimeout(reset);
        reset = setTimeout(() => setOutcome(undefined), copied ? 2400 : 12000);
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
                        aria-describedby={description()}
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
                    {outcome() === "copied" ? "Copied" : "Copy overlay URL"}
                </button>
            </div>
            <p class={styles.hint}>
                <Show when={url()} fallback={<span id="overlay-hint">No account, no login.</span>}>
                    <a ref={preview} class={styles.url} href={url()} target="_blank" rel="noopener">
                        {url()}
                    </a>
                </Show>
            </p>
            <p class={styles.status} role="status">
                <Switch>
                    <Match when={invalid()}>
                        <span id="overlay-error" class={styles.error}>
                            Channel names use letters, numbers and underscores.
                        </span>
                    </Match>
                    <Match when={outcome() === "copied"}>
                        Copied. Now add it to OBS as a browser source.
                    </Match>
                    <Match when={outcome() === "selected"}>
                        Copying did not work, so the link is selected: press Ctrl+C, or ⌘C on a Mac.
                    </Match>
                </Switch>
            </p>
            <p class={styles.next} classList={{ [styles.waiting]: !url() }}>
                <a class="seed-link" href="#setup">
                    Choose the look
                </a>
            </p>
        </form>
    );
}
