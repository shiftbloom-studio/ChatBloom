import { useLocation } from "@solidjs/router";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

import { brand } from "~/theme";
import {
    nextPreference,
    overlayPath,
    parsePreference,
    type ResolvedTheme,
    resolveTheme,
    storageKey,
    type ThemePreference,
    themeColor,
} from "./mode";

// Module state is only ever written in the browser, so server renders all see the defaults and
// hydration matches.
const [preference, setPreference] = createSignal<ThemePreference>("system");
const [systemDark, setSystemDark] = createSignal(false);
/** True once the stored preference has been read, so the toggle never flashes a wrong state. */
const [ready, setReady] = createSignal(false);
/** The Dark Reader extension is theming this page, so the toggle has nothing to add. */
const [external, setExternal] = createSignal(false);

// Ink becomes the paper and warm white the type: the brand's two neutrals, swapped.
const night = {
    mode: 1,
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0,
    darkSchemeBackgroundColor: themeColor.dark,
    darkSchemeTextColor: "#F4EEF0",
    styleSystemControls: true,
} satisfies Partial<DarkReader.Theme>;

// Left to itself Dark Reader dims every red as if it were a background, and the flower is the
// one thing that must not dim. The Bloom keeps its own gradients (`data-keep-colors`), and filled
// Bloom Red surfaces keep their red through Dark Reader's own `--darkreader-bg--<variable>`
// hooks. Red text is left alone: it is lightened until it reads on Ink, which is what it needs.
const fixes: DarkReader.DynamicThemeFix = {
    invert: [],
    css: `:root {
        --darkreader-bg--bloom: ${brand.bloom} !important;
        --darkreader-bg--root: ${brand.root} !important;
    }`,
    ignoreInlineStyle: ["[data-keep-colors]", "[data-keep-colors] *"],
    ignoreImageAnalysis: [],
    disableStyleSheetsProxy: false,
    ignoreCSSUrl: [],
};

let darkReader: Promise<typeof import("darkreader")> | undefined;

// Dark Reader touches `window` while it loads and weighs a few hundred kilobytes, so it is a
// browser-only chunk that light-mode visitors never fetch.
function loadDarkReader() {
    if (import.meta.env.SSR) throw new Error("Dark Reader only runs in the browser");
    darkReader ??= import("darkreader").catch((error) => {
        darkReader = undefined; // let the next attempt fetch it again
        throw error;
    });
    return darkReader;
}

// Turning it off never loads it: if it was never enabled, there is nothing to undo.
async function release() {
    try {
        (await darkReader)?.disable();
    } catch {
        // It never loaded, so it never ran.
    }
}

// Every Dark Reader instance marks the page with `meta[name=darkreader]`, and a newer one takes
// over from an older one. The extension counts as the older one: when it already themes the page,
// the visitor has chosen their own settings, and this copy must not replace them.
function extensionActive() {
    return document.querySelector('meta[name="darkreader"]') !== null;
}

function paintThemeColor(theme: ResolvedTheme) {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        meta.content = themeColor[theme];
    }
}

let run = 0;

async function apply(theme: ResolvedTheme, bypass: boolean) {
    const id = ++run;
    const root = document.documentElement;

    if (bypass) {
        // The overlay must stay exactly as authored.
        await release();
        delete root.dataset.theme;
        delete root.dataset.themePending;
        return;
    }

    root.dataset.theme = theme;

    if (theme === "light") {
        await release();
        if (id !== run) return;
        paintThemeColor("light");
        delete root.dataset.themePending;
        return;
    }

    try {
        const { isEnabled, enable } = await loadDarkReader();
        if (id !== run) return;
        if (!isEnabled() && extensionActive()) {
            setExternal(true);
            delete root.dataset.theme;
            return;
        }
        setExternal(false);
        paintThemeColor("dark");
        enable(night, fixes);
    } catch (error) {
        // The chunk did not load: better a light page than a hidden one.
        console.warn("Dark mode is unavailable", error);
        if (id === run) {
            root.dataset.theme = "light";
            paintThemeColor("light");
        }
    } finally {
        // Two frames, so the page is revealed after the themed styles have been painted.
        if (id === run) {
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    if (id === run) delete root.dataset.themePending;
                }),
            );
        }
    }
}

function read(): ThemePreference {
    try {
        return parsePreference(localStorage.getItem(storageKey));
    } catch {
        return "system";
    }
}

/**
 * Keeps the page in the visitor's theme. Renders nothing; mount it once, inside the router.
 * The OBS overlay is exempt, also when it is reached by client-side navigation.
 */
export function ThemeSync() {
    const location = useLocation();
    const overlay = () => overlayPath.test(location.pathname);

    onMount(() => {
        const scheme = matchMedia("(prefers-color-scheme: dark)");
        const onScheme = () => setSystemDark(scheme.matches);
        const onStorage = (event: StorageEvent) => {
            if (event.key === storageKey) setPreference(parsePreference(event.newValue));
        };
        setSystemDark(scheme.matches);
        setPreference(read());
        setReady(true);
        scheme.addEventListener("change", onScheme);
        addEventListener("storage", onStorage);
        onCleanup(() => {
            scheme.removeEventListener("change", onScheme);
            removeEventListener("storage", onStorage);
        });
    });

    createEffect(() => {
        const theme = resolveTheme(preference(), systemDark());
        void apply(theme, overlay());
    });

    return null;
}

export function useTheme() {
    return {
        preference,
        ready,
        external,
        resolved: () => resolveTheme(preference(), systemDark()),
        cycle() {
            const next = nextPreference(preference());
            setPreference(next);
            try {
                localStorage.setItem(storageKey, next);
            } catch {
                // Storage is blocked: the choice still holds until the page is left.
            }
        },
    };
}
