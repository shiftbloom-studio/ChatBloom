import { For, Match, Show, Switch } from "solid-js";

import type { BTTVUsernameEffect } from "~/lib/chat/providers/bttv";
import type { Paint } from "~/lib/chat/providers/seventv/paint";

import styles from "./Chat.module.css";

/** BTTV's texture effects, with the outline color each one's SVG stroke filter uses. */
export const BTTV_TEXTURES: Partial<Record<BTTVUsernameEffect, string>> = {
    iridescence: "#2f395f",
    supernova: "#702838",
    glacier: "#166258",
    intergalactic: "#4e316c",
    midas: "#674911",
};

function PaintedText(props: { paint: Paint; text: string }) {
    return (
        <Show
            when={props.paint.layers.length > 0}
            fallback={
                <span class={styles.paint} style={{ filter: props.paint.filter }}>
                    {props.text}
                </span>
            }
        >
            <span class={styles.paint} title={`7TV paint: ${props.paint.name}`}>
                <For each={props.paint.layers}>
                    {(layer, index) => (
                        <span
                            class={styles.paintLayer}
                            aria-hidden={index() > 0}
                            style={{
                                opacity: layer.opacity,
                                "background-image": layer.image,
                                "background-color": layer.color,
                                // Shadows go on the first layer only, like 7TV renders them.
                                filter: index() === 0 ? props.paint.filter : undefined,
                            }}
                        >
                            {props.text}
                        </span>
                    )}
                </For>
            </span>
        </Show>
    );
}

function BTTVEffectText(props: { effect: BTTVUsernameEffect; text: string }) {
    const texture = () => BTTV_TEXTURES[props.effect] !== undefined;
    return (
        <span
            class={texture() ? styles.texture : styles[props.effect]}
            style={
                texture()
                    ? {
                          "background-image": `url("https://cdn.betterttv.net/assets/username_effects/${props.effect}.png")`,
                          filter: `url(#cb-bttv-${props.effect})`,
                      }
                    : undefined
            }
        >
            {props.text}
        </span>
    );
}

/** A chatter's name in their color, wearing their 7TV paint or else their BTTV effect. */
export default function Username(props: {
    name: string;
    color: string;
    paint?: Paint;
    effect?: BTTVUsernameEffect;
}) {
    return (
        <span class={styles.name} style={{ color: props.color }}>
            <Switch fallback={props.name}>
                <Match when={props.paint}>
                    {(paint) => <PaintedText paint={paint()} text={props.name} />}
                </Match>
                <Match when={props.effect}>
                    {(effect) => <BTTVEffectText effect={effect()} text={props.name} />}
                </Match>
            </Switch>
        </span>
    );
}

/** SVG outline filters the BTTV texture effects reference; rendered once per overlay. */
export function BTTVEffectFilters() {
    return (
        <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
            <defs>
                <For each={Object.entries(BTTV_TEXTURES)}>
                    {([effect, color]) => (
                        <filter
                            id={`cb-bttv-${effect}`}
                            x="-20%"
                            y="-20%"
                            width="140%"
                            height="150%"
                        >
                            <feMorphology
                                in="SourceAlpha"
                                operator="dilate"
                                radius="1"
                                result="dilated"
                            />
                            <feOffset in="dilated" dy="2" result="dilatedBottom" />
                            <feFlood flood-color={color} result="outlineColor" />
                            <feComposite
                                in="outlineColor"
                                in2="dilatedBottom"
                                operator="in"
                                result="bottom"
                            />
                            <feComposite
                                in="outlineColor"
                                in2="dilated"
                                operator="in"
                                result="outline"
                            />
                            <feMerge>
                                <feMergeNode in="bottom" />
                                <feMergeNode in="outline" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    )}
                </For>
            </defs>
        </svg>
    );
}
