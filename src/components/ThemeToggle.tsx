import { Match, Show, Switch } from "solid-js";
import { useTheme } from "~/lib/theme/controller";
import { nextPreference } from "~/lib/theme/mode";
import styles from "./ThemeToggle.module.css";

const names = { system: "device setting", light: "light", dark: "dark" } as const;

// One button, three states: follow the device, or force light or dark. It cycles rather than
// opens a menu because the header has room for nothing more, and a state that is always visible
// needs no menu to explain it.
export default function ThemeToggle() {
    const theme = useTheme();
    const label = () =>
        `Color theme: ${names[theme.preference()]}. Switch to ${names[nextPreference(theme.preference())]}.`;

    return (
        <Show when={!theme.external()}>
            <button
                type="button"
                class={styles.toggle}
                classList={{ [styles.ready]: theme.ready() }}
                aria-label={label()}
                title={label()}
                onClick={() => theme.cycle()}
            >
                <svg
                    viewBox="0 0 16 16"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-hidden="true"
                >
                    <Switch>
                        <Match when={theme.preference() === "system"}>
                            <circle cx="8" cy="8" r="5.25" />
                            <path
                                d="M8 2.75a5.25 5.25 0 0 1 0 10.5z"
                                fill="currentColor"
                                stroke="none"
                            />
                        </Match>
                        <Match when={theme.preference() === "light"}>
                            <circle cx="8" cy="8" r="2.75" />
                            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
                        </Match>
                        <Match when={theme.preference() === "dark"}>
                            <path d="M13.25 9.4A5.5 5.5 0 0 1 6.6 2.75a5.5 5.5 0 1 0 6.65 6.65z" />
                        </Match>
                    </Switch>
                </svg>
            </button>
        </Show>
    );
}
