import { For } from "solid-js";

import { steps } from "~/lib/seo/site";
import styles from "./Steps.module.css";

// An ordered list: the sequence is the content. Ruled with hairlines, like every list here.
// The words live in src/lib/seo/site.ts, where the structured data reads them too. Plain
// elements and one stylesheet: a themed component would add a <style> element per line of text
// to a page that is weighed by search engines.
export default function Steps() {
    return (
        <ol class={styles.steps}>
            <For each={steps}>
                {(step, index) => (
                    <li class={styles.step}>
                        <p class={styles.number}>{String(index() + 1).padStart(2, "0")}</p>
                        <h3 class={styles.title}>{step.title}</h3>
                        <p class={styles.text}>{step.text}</p>
                    </li>
                )}
            </For>
        </ol>
    );
}
