import styles from "./Wordmark.module.css";

// "shiftbloom" display semibold, "studio" display regular at 60% ink, and the
// seed, which is always Bloom Red. Never capitalize, hyphenate, split across
// lines or drop the seed.
export default function Wordmark(props: { class?: string }) {
    return (
        <span class={[styles.wordmark, props.class].filter(Boolean).join(" ")}>
            shiftbloom <span class={styles.studio}>studio</span>
            <span class={styles.seed}>.</span>
        </span>
    );
}
