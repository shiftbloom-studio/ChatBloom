import Container from "@suid/material/Container";
import { For } from "solid-js";

import Wordmark from "~/components/brand/Wordmark";
import styles from "./SiteFooter.module.css";

const links = [
    { label: "Source on GitHub", href: "https://github.com/shiftbloom-studio/ChatBloom" },
    { label: "shiftbloom.studio", href: "https://shiftbloom.studio" },
    { label: "Open Collective", href: "https://opencollective.com/shiftbloom-studio" },
    { label: "hello@shiftbloom.studio", href: "mailto:hello@shiftbloom.studio" },
];

export default function SiteFooter() {
    return (
        <Container component="footer">
            <div class={styles.footer}>
                <a class={styles.wordmark} href="https://shiftbloom.studio">
                    <Wordmark />
                </a>
                <p class={styles.lede}>
                    ChatBloom is tended by shiftbloom studio, an open digital studio in Hamburg. It
                    grew from{" "}
                    <a class={styles.credit} href="https://github.com/IS2511/ChatIS">
                        ChatIS by IS2511
                    </a>
                    .
                </p>
                <nav class={styles.links} aria-label="shiftbloom studio">
                    <For each={links}>
                        {(link) => (
                            <a class="seed-link" href={link.href}>
                                {link.label}
                            </a>
                        )}
                    </For>
                </nav>
                <div class={styles.margins}>
                    <span>Open by default · A little informal · Based in Hamburg</span>
                    <span>chat.shiftbloom.studio — 53.55°N 9.99°E</span>
                </div>
            </div>
        </Container>
    );
}
