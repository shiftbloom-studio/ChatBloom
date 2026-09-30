import { createSignal } from "solid-js";

import { parseChannel } from "../../lib/channel";
import {
    DEFAULT_SETTINGS,
    type OverlaySettings,
    parseCustomFont,
    parseIgnoreList,
} from "../../lib/overlay/settings";
import { debounce } from "./debounce";
import { readFadeSeconds, SUGGESTED_FADE } from "./fade";
import { overlayUrl, PRODUCTION_ORIGIN, previewPath } from "./link";

/** Milliseconds after the last keystroke before the preview switches to the typed channel. */
const PREVIEW_CHANNEL_PAUSE = 800;

import { countChanged } from "./options";

const ALL_SETTINGS = Object.keys(DEFAULT_SETTINGS) as (keyof OverlaySettings)[];

const DEFAULT_FADE = DEFAULT_SETTINGS.fade || SUGGESTED_FADE;

/**
 * The channel and the look of one visit to the start page. The hero and the setup section
 * share it, so the link they show and copy is the same link. Everything lives in signals and
 * ends up in the link: no cookies, no storage, no requests.
 */
export function createSetup() {
    const [channelText, setChannelText] = createSignal("");
    const [settings, setSettings] = createSignal(DEFAULT_SETTINGS);
    // The texts as typed: the settings only hold what the overlay accepts of them.
    const [customText, setCustomText] = createSignal(DEFAULT_SETTINGS.custom);
    const [ignoreText, setIgnoreText] = createSignal(DEFAULT_SETTINGS.ignore.join(" "));
    // The time that fading returns to when it is switched off and on again.
    const [fadeChoice, setFadeChoice] = createSignal(DEFAULT_FADE);
    const [origin, setOrigin] = createSignal(PRODUCTION_ORIGIN);

    const channel = () => parseChannel(channelText());
    // The preview follows the channel once typing has stopped for a moment, so that it does
    // not reload, and ask for the badges of a half-typed name, with every keystroke.
    const [previewChannel, setPreviewChannel] = createSignal<string | undefined>(undefined);
    const followChannel = debounce(() => setPreviewChannel(channel()), PREVIEW_CHANNEL_PAUSE);

    const set = <Key extends keyof OverlaySettings>(key: Key, value: OverlaySettings[Key]) =>
        setSettings((current) => ({ ...current, [key]: value }));

    return {
        channelText,
        channel,
        settings,
        customText,
        ignoreText,
        origin,
        set,
        setChannelText(text: string) {
            setChannelText(text);
            followChannel();
        },
        /** Links use the origin the visitor is on, which the prerendered page cannot know. */
        setOrigin,

        /** The finished link; undefined until there is a channel to link to. */
        url(): string | undefined {
            const name = channel();
            return name ? overlayUrl(origin(), name, settings()) : undefined;
        },

        previewPath: () => previewPath(settings(), previewChannel()),

        /** Whether any setting differs from the defaults. */
        changed: () => countChanged(settings(), ALL_SETTINGS) > 0,

        /** Whether the custom font field holds a name that the link cannot carry. */
        customRefused: () => customText().trim() !== "" && settings().custom === "",

        typeCustom(text: string) {
            setCustomText(text);
            set("custom", parseCustomFont(text));
        },

        typeIgnore(text: string) {
            setIgnoreText(text);
            set("ignore", parseIgnoreList(text));
        },

        switchFade(on: boolean) {
            set("fade", on ? fadeChoice() : 0);
        },

        /** A half-typed time leaves the link as it is. */
        typeFade(text: string) {
            const seconds = readFadeSeconds(text);
            if (seconds === undefined) return;
            setFadeChoice(seconds);
            set("fade", seconds);
        },

        /** Back to the default look. The channel stays: it is not part of the look. */
        reset() {
            setSettings(DEFAULT_SETTINGS);
            setCustomText(DEFAULT_SETTINGS.custom);
            setIgnoreText(DEFAULT_SETTINGS.ignore.join(" "));
            setFadeChoice(DEFAULT_FADE);
        },
    };
}

export type Setup = ReturnType<typeof createSetup>;
