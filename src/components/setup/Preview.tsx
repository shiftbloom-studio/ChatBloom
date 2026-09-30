import Typography from "@suid/material/Typography";
import { createEffect, createSignal, For, on, untrack } from "solid-js";

import controls from "./controls.module.css";
import styles from "./Preview.module.css";

interface Frame {
    src: string;
}

type PreviewProps = {
    /** Path of the overlay in demo mode, on the page's own origin. */
    src: string;
};

// Ink darkened by 15% (OKLCH lightness), so that at night the scene stands off the page and the
// light chat text reads better, and a shade off paper so that the bright scene still reads as a
// surface. They are set inline on elements marked `data-keep-colors`, which night mode leaves as
// they are (src/lib/theme): a scene is as dark or as bright as the stream, whatever the site wears.
const DARK = "#130c10";
const LIGHT = "#f3f0f1";

// The overlay is never themed, and a frame whose color scheme differs from that of its document
// is painted on an opaque canvas: white, where the scene should show through. At night Dark
// Reader turns every frame dark with an important rule and rewrites the color schemes of
// stylesheets, so the frame says light inline, and as importantly.
const FRAME_STYLE = "color-scheme: light !important";

export default function Preview(props: PreviewProps) {
    const [light, setLight] = createSignal(false);
    const [frames, setFrames] = createSignal<Frame[]>([{ src: untrack(() => props.src) }]);

    // A new look gets a frame of its own, which waits unseen behind the one on screen until
    // it has loaded: the preview changes from one picture to the next instead of going blank
    // in between. Fresh frames also keep the browser's back button free of preview states,
    // which navigating a single frame would pile up.
    createEffect(
        on(
            () => props.src,
            (src) => setFrames(([shown]) => [shown, { src }]),
            { defer: true },
        ),
    );

    const settle = (frame: Frame) => {
        if (frames().length > 1 && frames().at(-1) === frame) setFrames([frame]);
    };

    return (
        <section aria-labelledby="setup-preview">
            <div class={styles.bar}>
                <Typography id="setup-preview" variant="overline" component="h3">
                    Preview
                </Typography>
                <button
                    type="button"
                    class={styles.surfaceSwitch}
                    onClick={() => setLight((value) => !value)}
                >
                    <span
                        class={styles.swatch}
                        style={{ "background-color": light() ? DARK : LIGHT }}
                        data-keep-colors
                        aria-hidden="true"
                    />
                    {light() ? "Dark background" : "Light background"}
                </button>
            </div>
            {/* The one dark surface of the site: it stands for the video under the chat. */}
            <div
                class={styles.surface}
                style={{ "background-color": light() ? LIGHT : DARK }}
                data-keep-colors
            >
                <For each={frames()}>
                    {(frame, index) => (
                        <iframe
                            class={styles.frame}
                            classList={{ [styles.waiting]: index() > 0 }}
                            style={FRAME_STYLE}
                            src={frame.src}
                            title="Preview of your chat overlay"
                            loading="lazy"
                            // Nothing in the overlay takes input, so it is no stop for the Tab key.
                            tabindex={-1}
                            onLoad={() => settle(frame)}
                        />
                    )}
                </For>
            </div>
            <p class={controls.hint}>
                Sample messages, so you can judge the look. Your own chat appears once the link runs
                in OBS.
            </p>
        </section>
    );
}
