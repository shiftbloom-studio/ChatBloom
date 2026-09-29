import { createUniqueId, For, Show } from "solid-js";

import styles from "./Bloom.module.css";

// The Bloom, drawn from the construction spec in Brand Book v2.0 §04: four
// petal rings and a seed, symmetry 36°. Same geometry as the studio's
// bloom.svg master. When in doubt, rebuild from the numbers.
type Ring = {
    /** Distance from the center to the petal tip (half the ring diameter). */
    tip: number;
    petals: number;
    /** Half-width of the petal's control polygon. */
    width: number;
    /** Root to tip. */
    length: number;
    /** Stem to tip: darker at the center, lighter at the edge. Flip it and the flower wilts. */
    from: string;
    to: string;
    /** Rotation in degrees, so neighbouring rings interleave. */
    offset: number;
};

// biome-ignore format: one ring per row, so it reads like the spec table
const RINGS: Ring[] = [
    { tip: 100, petals: 10, width: 32,    length: 90,   from: "#D8163F", to: "#FF2E52", offset: 0 },
    { tip: 74,  petals: 10, width: 25.16, length: 66.6, from: "#FF2E52", to: "#FF7E9E", offset: 18 },
    { tip: 50,  petals: 8,  width: 19,    length: 45,   from: "#FF7E9E", to: "#FFC2D3", offset: 40.5 },
    { tip: 27,  petals: 6,  width: 12.96, length: 24.3, from: "#FFB4CA", to: "#FFDCE7", offset: 70.5 },
];

const BLOOM_RED = "#FF2E52";
const ROOT_RED = "#C81040";

/** One cubic pair, mirrored: root at the origin, tip at (0, -length). */
function petal({ width: w, length: l }: Ring) {
    const c = Math.round(55 * l) / 100;
    return `M 0,0 C ${w},0 ${w},${-c} 0,${-l} C ${-w},${-c} ${-w},0 0,0 Z`;
}

function angles(ring: Ring) {
    return Array.from({ length: ring.petals }, (_, i) => ring.offset + (360 / ring.petals) * i);
}

type BloomProps = {
    /** Full gradient from 32px up. Smaller than that, only the solid bloom reads. */
    variant?: "gradient" | "solid";
    /** Unfurl on load, then breathe while idle as the rings counter-rotate. */
    alive?: boolean;
    /** Accessible name. Without one the mark is decorative. */
    title?: string;
    class?: string;
};

export default function Bloom(props: BloomProps) {
    const id = `bloom-${createUniqueId()}`;
    const solid = () => props.variant === "solid";

    return (
        <svg
            viewBox="-100 -100 200 200"
            // The mark is drawn from the spec's colors, at night too: see src/lib/theme.
            data-keep-colors=""
            class={[styles.bloom, props.alive && styles.alive, props.class]
                .filter(Boolean)
                .join(" ")}
            role={props.title ? "img" : undefined}
            aria-label={props.title}
            aria-hidden={props.title ? undefined : true}
        >
            <Show when={!solid()}>
                <defs>
                    <For each={RINGS}>
                        {(ring, i) => (
                            <linearGradient
                                id={`${id}-${i()}`}
                                gradientUnits="userSpaceOnUse"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2={-ring.length}
                            >
                                <stop offset="0" stop-color={ring.from} />
                                <stop offset="1" stop-color={ring.to} />
                            </linearGradient>
                        )}
                    </For>
                </defs>
            </Show>
            <For each={RINGS}>
                {(ring, i) => (
                    <g class={styles.ring} fill={solid() ? BLOOM_RED : `url(#${id}-${i()})`}>
                        <For each={angles(ring)}>
                            {(angle) => (
                                <path
                                    d={petal(ring)}
                                    transform={`rotate(${angle}) translate(0 ${ring.length - ring.tip})`}
                                />
                            )}
                        </For>
                    </g>
                )}
            </For>
            {/* The seed. In the solid bloom it darkens to Root Red so it stays visible. */}
            <circle r="7" fill={solid() ? ROOT_RED : BLOOM_RED} />
        </svg>
    );
}
