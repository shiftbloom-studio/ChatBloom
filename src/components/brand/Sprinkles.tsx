import { For, type JSX } from "solid-js";

import styles from "./Sprinkles.module.css";

// The sky around the flower (Brand Book v2.0 §07): a spark, a cross and a dot.
// At most seven per composition, red or ink only on white, margins only, and
// never inside the mark's clearspace (a quarter of its height on every side).
const glyphs = {
    spark: () => <path d="M0-10C.6-2 2-.6 10 0 2 .6.6 2 0 10-.6 2-2 .6-10 0-2-.6-.6-2 0-10Z" />,
    cross: () => <path d="M-3.4-10h6.8v6.6H10v6.8H3.4V10h-6.8V3.4H-10v-6.8h6.6Z" />,
    dot: () => <circle r="10" />,
};

type Sprinkle = {
    glyph: keyof typeof glyphs;
    color: "bloom" | "ink";
    /** Spark 8–24px, cross 8–16px, dot 6–10px. */
    size: number;
    /** Where it sits in the margin, as CSS insets. */
    at: JSX.CSSProperties;
};

const sky: Sprinkle[] = [
    { glyph: "spark", color: "bloom", size: 24, at: { top: "14%", left: "15%" } },
    { glyph: "dot", color: "bloom", size: 7, at: { top: "34%", left: "6%" } },
    { glyph: "cross", color: "ink", size: 12, at: { top: "11%", right: "20%" } },
    { glyph: "dot", color: "ink", size: 6, at: { top: "37%", right: "12%" } },
    { glyph: "spark", color: "ink", size: 15, at: { top: "57%", right: "19%" } },
    { glyph: "cross", color: "bloom", size: 10, at: { top: "61%", left: "11%" } },
];

export default function Sprinkles() {
    return (
        <div class={styles.sky}>
            <For each={sky}>
                {(sprinkle) => (
                    <svg
                        class={`${styles.sprinkle} ${styles[sprinkle.color]}`}
                        aria-hidden="true"
                        viewBox="-10 -10 20 20"
                        width={sprinkle.size}
                        height={sprinkle.size}
                        style={sprinkle.at}
                    >
                        {glyphs[sprinkle.glyph]()}
                    </svg>
                )}
            </For>
        </div>
    );
}
