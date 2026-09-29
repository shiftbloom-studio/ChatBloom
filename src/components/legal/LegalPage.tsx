import { Meta } from "@solidjs/meta";
import Container from "@suid/material/Container";
import Typography from "@suid/material/Typography";
import { For, type ParentProps, Show } from "solid-js";

import MySiteTitle from "~/components/MySiteTitle";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";
import styles from "./LegalPage.module.css";

type LegalPageProps = ParentProps<{
    lang: "en" | "de";
    title: string;
    /** The same page in the other language. */
    translation: string;
    /** E.g. "Last updated 29 September 2026", in the page's language. */
    updated?: string;
}>;

const languages = [
    { lang: "en", label: "English" },
    { lang: "de", label: "Deutsch" },
] as const;

// Imprint and privacy policy, in English and German. Plain prose: the text is the design.
export default function LegalPage(props: LegalPageProps) {
    const de = () => props.lang === "de";
    return (
        <>
            <MySiteTitle>{props.title}</MySiteTitle>
            {/* Linked from every page, but kept out of search results along with the address. */}
            <Meta name="robots" content="noindex" />
            <SiteHeader />
            <Container component="main">
                <article class={styles.page} lang={props.lang}>
                    <Typography variant="overline" component="p" color="text.secondary">
                        {de() ? "Petal — Rechtliches" : "Petal — legal"}
                    </Typography>
                    <Typography variant="h2" component="h1" class={styles.title}>
                        {props.title}
                    </Typography>
                    <div class={styles.meta}>
                        <nav class={styles.languages} aria-label={de() ? "Sprache" : "Language"}>
                            <For each={languages}>
                                {(language) => (
                                    <Show
                                        when={language.lang !== props.lang}
                                        fallback={<span aria-current="page">{language.label}</span>}
                                    >
                                        <a
                                            class="seed-link"
                                            href={props.translation}
                                            hreflang={language.lang}
                                            lang={language.lang}
                                        >
                                            {language.label}
                                        </a>
                                    </Show>
                                )}
                            </For>
                        </nav>
                        <Show when={props.updated}>{(updated) => <p>{updated()}</p>}</Show>
                    </div>
                    <div class={styles.prose}>{props.children}</div>
                </article>
            </Container>
            <SiteFooter lang={props.lang} />
        </>
    );
}
