import Typography from "@suid/material/Typography";
import { createEffect, createSignal, Match, on, onCleanup, Switch } from "solid-js";

import { CHANNEL_FIELD } from "~/components/OverlayLink";
import { copyText } from "./clipboard";
import controls from "./controls.module.css";
import styles from "./PersonalLink.module.css";
import type { Setup } from "./store";

// The link of the hero once more, where the look is chosen: the same link, from the same state.
export default function PersonalLink(props: { setup: Setup }) {
    const [outcome, setOutcome] = createSignal<"copied" | "selected">();
    let field: HTMLInputElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(timer));

    const url = () => props.setup.url();

    // A link that has changed is no longer the one on the clipboard.
    createEffect(on(url, () => setOutcome(undefined), { defer: true }));

    const copy = async () => {
        const link = url();
        if (!link) return;
        const copied = await copyText(link);
        if (!copied) {
            field?.focus();
            field?.select();
        }
        setOutcome(copied ? "copied" : "selected");
        clearTimeout(timer);
        timer = setTimeout(() => setOutcome(undefined), copied ? 4000 : 12000);
    };

    return (
        <section class={styles.link} aria-labelledby="setup-link">
            <Typography id="setup-link" variant="h4" component="h3" sx={{ mb: 3 }}>
                Your link.
            </Typography>
            <div class={styles.row}>
                <input
                    ref={field}
                    class={styles.url}
                    type="text"
                    readonly
                    value={url() ?? ""}
                    placeholder={`${props.setup.origin()}/chat/…`}
                    aria-labelledby="setup-link"
                    aria-describedby="setup-link-hint"
                    onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" class={styles.copy} disabled={!url()} onClick={copy}>
                    {outcome() === "copied" ? "Copied" : "Copy link"}
                </button>
            </div>
            <div class={styles.below}>
                <div class={styles.actions}>
                    {/* Without a channel there is nothing to open: no href, and said so. */}
                    <a
                        class={`seed-link ${styles.action}`}
                        href={url()}
                        target="_blank"
                        rel="noopener"
                        aria-disabled={url() ? undefined : "true"}
                    >
                        Open overlay
                    </a>
                    <button
                        type="button"
                        class={`seed-link ${styles.action}`}
                        disabled={!props.setup.changed()}
                        onClick={() => props.setup.reset()}
                    >
                        Reset to defaults
                    </button>
                </div>
                <p class={styles.status} role="status">
                    <Switch>
                        <Match when={!url()}>
                            <a
                                class={styles.channel}
                                href={`#${CHANNEL_FIELD}`}
                                onClick={(event) => {
                                    // A link to a field only scrolls to it; the cursor has to follow.
                                    event.preventDefault();
                                    document.getElementById(CHANNEL_FIELD)?.focus();
                                }}
                            >
                                Enter your channel
                            </a>{" "}
                            at the top of the page to get your link.
                        </Match>
                        <Match when={outcome() === "copied"}>
                            Copied. Paste it into OBS as the URL of a browser source.
                        </Match>
                        <Match when={outcome() === "selected"}>
                            Your browser keeps the clipboard closed. The link is selected: copy it
                            with Ctrl+C, or ⌘C on a Mac.
                        </Match>
                    </Switch>
                </p>
            </div>
            <p id="setup-link-hint" class={controls.hint}>
                Every setting travels in the link itself. Nothing is stored, and there is no
                account.
            </p>
        </section>
    );
}
