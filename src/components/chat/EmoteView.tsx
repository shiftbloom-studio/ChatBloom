import { createSignal, For, type JSX, Show } from "solid-js";

import type { EmotePart } from "~/lib/chat/tokenize";
import type { Emote, ImageSet } from "~/lib/chat/types";

import styles from "./Chat.module.css";

export const EMOTE_HEIGHT = 32;

/**
 * Width descriptors scaled from a base height, so the browser picks an image for the rendered
 * size rather than only for the device pixel ratio. Aspect ratio doesn't matter here: it is the
 * same at every density.
 */
export function sizedSrcset(images: ImageSet, baseHeight: number): string {
    return Object.entries(images)
        .map(([density, url]) => `${url} ${Math.round(baseHeight * Number(density))}w`)
        .join(", ");
}

function EmoteImage(props: {
    emote: Emote;
    style?: JSX.CSSProperties;
    onAspect?: (a: number) => void;
}) {
    return (
        <img
            srcset={sizedSrcset(props.emote.images, props.emote.height ?? 28)}
            sizes={`${EMOTE_HEIGHT}px`}
            alt={props.emote.name}
            title={props.emote.name}
            style={props.style}
            onLoad={(event) => {
                const img = event.currentTarget;
                props.onAspect?.(img.naturalWidth / img.naturalHeight);
            }}
        />
    );
}

export default function EmoteView(props: { part: EmotePart }) {
    const [loadedAspect, setLoadedAspect] = createSignal<number>();
    const effects = () => props.part.effects;

    const aspect = () => {
        const { width, height } = props.part.emote;
        return width && height ? width / height : loadedAspect();
    };
    /** Explicit width in px, only when an effect changes it. */
    const width = () => {
        const fx = effects();
        if (fx.aspectRatio) return EMOTE_HEIGHT * fx.aspectRatio;
        if (fx.widthScale === 1 && !fx.slide) return undefined;
        // A sliding emote is a background with nothing to measure, so assume square if unknown.
        const ratio = aspect() ?? (fx.slide ? 1 : undefined);
        return ratio ? EMOTE_HEIGHT * ratio * fx.widthScale : undefined;
    };

    const style = (): JSX.CSSProperties => {
        const fx = effects();
        const filter = fx.filters.join(" ") || undefined;
        const w = width();
        const animations = [...fx.animations];
        if (fx.slide && w)
            animations.push(`cb-fx-slide ${(w / EMOTE_HEIGHT) * 1.5}s linear infinite`);
        return {
            width: w === undefined ? undefined : `${w}px`,
            "object-fit": w === undefined ? undefined : "fill",
            transform: fx.transforms.join(" ") || undefined,
            "transform-origin": fx.transformOrigin,
            filter,
            "--cb-fx-f": filter,
            "--cb-slide-width": fx.slide && w ? `${w}px` : undefined,
            animation: animations.join(", ") || undefined,
        };
    };

    return (
        <span class={styles.emote}>
            <Show
                when={effects().slide}
                fallback={
                    <EmoteImage
                        emote={props.part.emote}
                        style={style()}
                        onAspect={setLoadedAspect}
                    />
                }
            >
                <span
                    role="img"
                    aria-label={props.part.emote.name}
                    class={styles.slide}
                    style={{
                        ...style(),
                        "background-image": `url("${props.part.emote.images[2] ?? props.part.emote.images[1]}")`,
                    }}
                />
            </Show>
            <For each={props.part.overlays}>{(overlay) => <EmoteImage emote={overlay} />}</For>
        </span>
    );
}
