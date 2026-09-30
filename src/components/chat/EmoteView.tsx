import { createMemo, createSignal, For, type JSX, Show } from "solid-js";

import { effectWidth } from "~/lib/chat/effects";
import type { EmotePart } from "~/lib/chat/tokenize";
import type { Emote, ImageSet } from "~/lib/chat/types";
import {
    emoteAspectRatio,
    emoteRatio,
    emoteRest,
    sizedSrcset,
    withoutImage,
} from "~/lib/overlay/images";
import { emoteScale } from "~/lib/overlay/look";

import styles from "./Chat.module.css";
import { useSettings } from "./settings";

export const EMOTE_HEIGHT = 32;

/**
 * An emote or a badge. When the file the browser picked from the srcset fails to load, the other
 * sizes of the set are tried, and `onFail` is called once none of them is left.
 *
 * The image stays transparent until it has loaded. Chromium draws a failed image as a
 * broken-image icon next to its alt text, and it may paint that for a frame before the error
 * event arrives, so taking the image away on the error alone would not keep it off stream.
 */
export function ChatImage(props: {
    images: ImageSet;
    /** The height of the 1x file, which the width descriptors of the srcset are scaled from. */
    baseHeight: number;
    sizes: string;
    alt: string;
    class?: string;
    style?: JSX.CSSProperties;
    hidden?: boolean;
    onLoad?: (img: HTMLImageElement) => void;
    onFail: () => void;
}) {
    // The images of an emote or a badge never change, so the set is only read to start from.
    const [images, setImages] = createSignal(props.images);
    const [loaded, setLoaded] = createSignal(false);
    return (
        <img
            class={props.class}
            srcset={sizedSrcset(images(), props.baseHeight)}
            sizes={props.sizes}
            alt={props.alt}
            title={props.alt}
            hidden={props.hidden}
            style={{ ...props.style, opacity: loaded() ? undefined : 0 }}
            onLoad={(event) => {
                setLoaded(true);
                props.onLoad?.(event.currentTarget);
            }}
            onError={(event) => {
                const img = event.currentTarget;
                setLoaded(false);
                const rest = withoutImage(images(), img.currentSrc, img.baseURI);
                if (rest) setImages(rest);
                else props.onFail();
            }}
        />
    );
}

function EmoteImage(props: {
    emote: Emote;
    style?: JSX.CSSProperties;
    hidden?: boolean;
    onLoad?: (img: HTMLImageElement) => void;
    onFail: () => void;
}) {
    const settings = useSettings();
    return (
        <ChatImage
            images={props.emote.images}
            baseHeight={props.emote.height ?? 28}
            sizes={`${EMOTE_HEIGHT * emoteScale(settings())}px`}
            alt={props.emote.name}
            // Zero-width emotes too: the widest emote of a stack sets the width of its cell.
            style={{ "aspect-ratio": emoteAspectRatio(props.emote), ...props.style }}
            hidden={props.hidden}
            onLoad={props.onLoad}
            onFail={props.onFail}
        />
    );
}

/**
 * An emote with the emotes stacked on it. An emote whose image cannot be loaded is shown as its
 * name, in the message text (see `emoteRest`).
 */
export default function EmoteView(props: { part: EmotePart }) {
    const settings = useSettings();
    const [loadedRatio, setLoadedRatio] = createSignal<number>();
    const [slideImage, setSlideImage] = createSignal<string>();
    const [failed, setFailed] = createSignal<readonly Emote[]>([]);
    const fail = (emote: Emote) => setFailed((emotes) => [...emotes, emote]);
    const rest = createMemo(() => emoteRest(props.part, failed()));
    const effects = () => props.part.effects;
    const height = () => EMOTE_HEIGHT * emoteScale(settings());

    /** Explicit width in px, only when an effect changes it. */
    const width = () =>
        effectWidth(effects(), height(), emoteRatio(props.part.emote, loadedRatio()));

    const style = (): JSX.CSSProperties => {
        const fx = effects();
        const filter = fx.filters.join(" ") || undefined;
        const w = width();
        const animations = [...fx.animations];
        if (fx.slide && w) animations.push(`cb-fx-slide ${(w / height()) * 1.5}s linear infinite`);
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

    const measure = (img: HTMLImageElement) => {
        if (img.naturalHeight > 0) setLoadedRatio(img.naturalWidth / img.naturalHeight);
    };

    return (
        <>
            {rest().before}
            <Show when={rest().base || rest().overlays.length > 0}>
                <span class={styles.emote}>
                    <Show when={rest().base}>
                        {(base) => (
                            <Show
                                when={effects().slide}
                                fallback={
                                    <EmoteImage
                                        emote={base()}
                                        style={style()}
                                        onLoad={measure}
                                        onFail={() => fail(base())}
                                    />
                                }
                            >
                                <span
                                    role="img"
                                    aria-label={base().name}
                                    class={styles.slide}
                                    style={{
                                        ...style(),
                                        "background-image": slideImage()
                                            ? `url("${slideImage()}")`
                                            : undefined,
                                    }}
                                />
                                {/* A background neither picks a size from a set nor reports a
                                    failure. So an image that is never shown picks and loads the
                                    file, trying the others if it fails, and the background shows
                                    the file it has loaded, which the browser then has at hand. */}
                                <EmoteImage
                                    emote={base()}
                                    hidden
                                    onLoad={(img) => {
                                        setSlideImage(img.currentSrc);
                                        measure(img);
                                    }}
                                    onFail={() => fail(base())}
                                />
                            </Show>
                        )}
                    </Show>
                    <For each={rest().overlays}>
                        {(overlay) => <EmoteImage emote={overlay} onFail={() => fail(overlay)} />}
                    </For>
                </span>
            </Show>
            {rest().after}
        </>
    );
}
