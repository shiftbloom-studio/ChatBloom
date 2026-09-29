import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";

import { FONTS } from "~/lib/overlay/settings";

import Choice from "./Choice";
import styles from "./Configurator.module.css";
import controls from "./controls.module.css";
import { debounce } from "./debounce";
import { MAX_FADE } from "./fade";
import { describeIgnoreList } from "./ignore";
import { countChanged, EMOTE_SIZES, MORE_OPTIONS, SHADOWS, SIZES, STROKES } from "./options";
import PersonalLink from "./PersonalLink";
import Preview from "./Preview";
import type { Setup } from "./store";
import Toggle from "./Toggle";

/** How long typing has to pause before the preview reloads. */
const PAUSE = 400;

// The basics in view, the rest behind "More options", the preview beside both.
export default function Configurator(props: { setup: Setup }) {
    const setup = props.setup;
    const settings = setup.settings;

    const [previewSrc, setPreviewSrc] = createSignal(setup.previewPath());
    const updatePreview = debounce(setPreviewSrc, PAUSE);
    createEffect(on(setup.previewPath, (path) => updatePreview(path), { defer: true }));
    onCleanup(() => updatePreview.cancel());

    const moreChanged = () => countChanged(settings(), MORE_OPTIONS);

    return (
        <>
            <form
                class={styles.configurator}
                // Browsers that refill forms on reload would show values the page knows
                // nothing about.
                autocomplete="off"
                novalidate
                onSubmit={(event) => event.preventDefault()}
            >
                <div class={`${styles.controls} ${controls.stack}`}>
                    <Choice
                        name="size"
                        label="Size"
                        options={SIZES}
                        value={settings().size}
                        onChange={(value) => setup.set("size", value)}
                    />
                    <div class={controls.field}>
                        <label class={controls.label} for="setup-font">
                            Font
                        </label>
                        <select
                            id="setup-font"
                            class={controls.select}
                            name="font"
                            aria-describedby={settings().custom ? "setup-font-hint" : undefined}
                            onChange={(event) => setup.set("font", event.currentTarget.value)}
                        >
                            <For each={FONTS}>
                                {(font) => (
                                    <option value={font.id} selected={font.id === settings().font}>
                                        {font.label}
                                    </option>
                                )}
                            </For>
                        </select>
                        <Show when={settings().custom}>
                            <p id="setup-font-hint" class={controls.hint}>
                                Replaced by your own font,{" "}
                                <span class={controls.mono}>{settings().custom}</span>.
                            </p>
                        </Show>
                    </div>
                    <Choice
                        name="stroke"
                        label="Outline"
                        options={STROKES}
                        value={settings().stroke}
                        onChange={(value) => setup.set("stroke", value)}
                    />
                    <Choice
                        name="shadow"
                        label="Shadow"
                        options={SHADOWS}
                        value={settings().shadow}
                        onChange={(value) => setup.set("shadow", value)}
                    />
                </div>

                <div class={styles.preview}>
                    <Preview src={previewSrc()} />
                </div>

                <details class={`${styles.controls} ${styles.more}`}>
                    <summary class={styles.summary}>
                        <span class={styles.summaryTitle}>More options</span>
                        <span class={styles.summaryNote}>
                            <Show
                                when={moreChanged() > 0}
                                fallback="Emotes, motion, badges, filters"
                            >
                                {moreChanged()} changed
                            </Show>
                        </span>
                    </summary>
                    <div class={styles.moreBody}>
                        <div class={controls.stack}>
                            <div class={controls.field}>
                                <label class={controls.label} for="setup-custom">
                                    Your own font
                                </label>
                                <input
                                    id="setup-custom"
                                    class={controls.input}
                                    type="text"
                                    name="custom"
                                    value={setup.customText()}
                                    placeholder="Comic Sans MS"
                                    maxlength="40"
                                    autocapitalize="none"
                                    autocorrect="off"
                                    spellcheck={false}
                                    aria-invalid={setup.customRefused() ? "true" : undefined}
                                    aria-describedby="setup-custom-hint setup-custom-error"
                                    onInput={(event) => setup.typeCustom(event.currentTarget.value)}
                                />
                                <p id="setup-custom-hint" class={controls.hint}>
                                    The name of a font that is installed on the computer that runs
                                    OBS.
                                </p>
                                <p
                                    id="setup-custom-error"
                                    class={controls.error}
                                    aria-live="polite"
                                >
                                    <Show when={setup.customRefused()}>
                                        Font names use letters, digits, spaces, hyphens, underscores
                                        and dots.
                                    </Show>
                                </p>
                            </div>
                            <Choice
                                name="emotes"
                                label="Emote size"
                                options={EMOTE_SIZES}
                                value={settings().emotes}
                                onChange={(value) => setup.set("emotes", value)}
                            />
                        </div>
                        <div class={styles.toggles}>
                            <Toggle
                                label="Slide-in animation"
                                hint="New messages slide in from below."
                                checked={settings().animate}
                                onChange={(value) => setup.set("animate", value)}
                            />
                            <Toggle
                                label="Fade out old messages"
                                hint="Off keeps messages until new ones push them out."
                                checked={settings().fade > 0}
                                onChange={setup.switchFade}
                            />
                            <Show when={settings().fade > 0}>
                                <div class={`${controls.field} ${controls.nested}`}>
                                    <label class={controls.label} for="setup-fade">
                                        Fade after
                                    </label>
                                    <div class={controls.measure}>
                                        <input
                                            id="setup-fade"
                                            class={controls.input}
                                            type="number"
                                            name="fade"
                                            min="1"
                                            max={MAX_FADE}
                                            step="1"
                                            inputmode="numeric"
                                            value={settings().fade}
                                            aria-describedby="setup-fade-unit"
                                            onInput={(event) =>
                                                setup.typeFade(event.currentTarget.value)
                                            }
                                            // A field left empty or half typed shows the time
                                            // the link carries.
                                            onBlur={(event) => {
                                                event.currentTarget.value = String(settings().fade);
                                            }}
                                        />
                                        <span id="setup-fade-unit" class={controls.hint}>
                                            seconds, up to {MAX_FADE}
                                        </span>
                                    </div>
                                </div>
                            </Show>
                            <Toggle
                                label="Line break after the name"
                                hint="The message starts on a new line below the name."
                                checked={settings().newline}
                                onChange={(value) => setup.set("newline", value)}
                            />
                            <Toggle
                                label="Show user names"
                                hint="Off shows the messages alone."
                                checked={settings().names}
                                onChange={(value) => setup.set("names", value)}
                            />
                            <Toggle
                                label="Show badges"
                                hint="Subscriber, moderator and the other badges before a name."
                                checked={settings().badges}
                                onChange={(value) => setup.set("badges", value)}
                            />
                            <Toggle
                                label="Show Homies badges"
                                hint="Badges from the Homies community, loaded from its servers."
                                checked={settings().homies}
                                onChange={(value) => setup.set("homies", value)}
                            />
                            <Toggle
                                label="Show bots"
                                hint="Messages of well-known bots such as Nightbot."
                                checked={settings().bots}
                                onChange={(value) => setup.set("bots", value)}
                            />
                            <Toggle
                                label="Show !commands"
                                hint="Messages that start with an exclamation mark."
                                checked={settings().commands}
                                onChange={(value) => setup.set("commands", value)}
                            />
                            <Toggle
                                label="Small caps"
                                hint="Lowercase letters become small capitals."
                                checked={settings().caps}
                                onChange={(value) => setup.set("caps", value)}
                            />
                        </div>
                        <div class={`${controls.field} ${styles.ignore}`}>
                            <label class={controls.label} for="setup-ignore">
                                Also hide these users
                            </label>
                            <input
                                id="setup-ignore"
                                class={controls.input}
                                type="text"
                                name="ignore"
                                value={setup.ignoreText()}
                                placeholder="name, name, name"
                                autocapitalize="none"
                                autocorrect="off"
                                spellcheck={false}
                                aria-describedby="setup-ignore-hint setup-ignore-count"
                                onInput={(event) => setup.typeIgnore(event.currentTarget.value)}
                            />
                            <p id="setup-ignore-hint" class={controls.hint}>
                                Twitch names, separated by spaces or commas.
                            </p>
                            <p id="setup-ignore-count" class={controls.hint} aria-live="polite">
                                {describeIgnoreList(setup.ignoreText(), settings().ignore)}
                            </p>
                        </div>
                    </div>
                </details>
            </form>

            <PersonalLink setup={setup} />
        </>
    );
}
