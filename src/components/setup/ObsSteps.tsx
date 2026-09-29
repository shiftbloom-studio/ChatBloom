import { For } from "solid-js";

import styles from "./ObsSteps.module.css";

const steps = [
    { title: "Add a browser source.", text: "In OBS, click + under Sources and choose Browser." },
    { title: "Paste your link.", text: "It goes into the field named URL." },
    {
        title: "Set the size.",
        text: "A width of 450 and a height of 800 are a good start. Resize it in the scene as you like.",
    },
    {
        title: "Leave the rest.",
        text: "No custom CSS is needed: the background is transparent already.",
    },
];

// An ordered list: the sequence is the content. Ruled with hairlines, like every list here.
export default function ObsSteps() {
    return (
        <>
            <ol class={styles.steps}>
                <For each={steps}>
                    {(step) => (
                        <li class={styles.step}>
                            <strong class={styles.title}>{step.title}</strong> {step.text}
                        </li>
                    )}
                </For>
            </ol>
            {/* The build targets the Chromium of OBS 31. Older versions embed an older one. */}
            <p class={styles.requirement}>Petal needs OBS 31 or newer.</p>
        </>
    );
}
