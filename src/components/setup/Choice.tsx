import { createUniqueId, For } from "solid-js";

import styles from "./controls.module.css";
import type { Option } from "./options";

type ChoiceProps<Value extends number> = {
    /** Groups the radio buttons, so it must be unique on the page. */
    name: string;
    label: string;
    options: readonly Option<Value>[];
    value: Value;
    onChange: (value: Value) => void;
};

// One of a few, all in view: real radio buttons, so arrow keys and screen readers work as
// they do everywhere else.
export default function Choice<Value extends number>(props: ChoiceProps<Value>) {
    const labelId = createUniqueId();
    return (
        <div class={styles.field} role="radiogroup" aria-labelledby={labelId}>
            <span id={labelId} class={styles.label}>
                {props.label}
            </span>
            <div class={styles.segments}>
                <For each={props.options}>
                    {(option) => (
                        <label class={styles.segment}>
                            <input
                                type="radio"
                                name={props.name}
                                value={option.value}
                                checked={props.value === option.value}
                                onChange={() => props.onChange(option.value)}
                            />
                            <span class={styles.face}>{option.label}</span>
                        </label>
                    )}
                </For>
            </div>
        </div>
    );
}
