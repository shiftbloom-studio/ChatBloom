import { For, Show } from "solid-js";

import { questions } from "~/lib/seo/site";
import styles from "./Questions.module.css";

// Questions as headings and answers as plain text, all of it on the page: nothing is folded
// away, so people, search engines and language models read the same words. They live in
// src/lib/seo/site.ts, where the structured data reads them too.
export default function Questions() {
    return (
        <div class={styles.questions}>
            <For each={questions}>
                {(entry) => (
                    <article class={styles.entry}>
                        <h3 class={styles.question}>{entry.question}</h3>
                        <p class={styles.answer}>{entry.answer}</p>
                        <Show when={entry.link}>
                            {(link) => (
                                <p class={styles.more}>
                                    <a class="seed-link" href={link().href}>
                                        {link().label}
                                    </a>
                                </p>
                            )}
                        </Show>
                    </article>
                )}
            </For>
        </div>
    );
}
