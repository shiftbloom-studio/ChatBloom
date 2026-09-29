import Container from "@suid/material/Container";

import Wordmark from "~/components/brand/Wordmark";
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
    return (
        <Container component="header">
            <div class={styles.bar}>
                <a class={styles.product} href="/v3">
                    ChatBloom<span class={styles.seed}>.</span>
                </a>
                <a class={styles.studio} href="https://shiftbloom.studio">
                    <span class={styles.by}>by</span> <Wordmark />
                </a>
            </div>
        </Container>
    );
}
