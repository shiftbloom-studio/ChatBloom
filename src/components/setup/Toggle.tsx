import { createUniqueId, Show } from "solid-js";

import styles from "./controls.module.css";

type ToggleProps = {
    label: string;
    /** What the switch does, where the label alone leaves it open. */
    hint?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
};

// A checkbox with the role of a switch. The hint is a description rather than part of the
// label, so screen readers announce the short name first.
export default function Toggle(props: ToggleProps) {
    const id = createUniqueId();
    const hintId = createUniqueId();
    return (
        <div class={styles.toggle}>
            <div class={styles.toggleText}>
                <label class={styles.label} for={id}>
                    {props.label}
                </label>
                <Show when={props.hint}>
                    <p id={hintId} class={styles.hint}>
                        {props.hint}
                    </p>
                </Show>
            </div>
            <span class={styles.switch}>
                <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    checked={props.checked}
                    aria-checked={props.checked}
                    aria-describedby={props.hint ? hintId : undefined}
                    onChange={(event) => props.onChange(event.currentTarget.checked)}
                />
                <span class={styles.track} aria-hidden="true" />
            </span>
        </div>
    );
}
