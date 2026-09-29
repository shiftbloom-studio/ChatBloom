// Dark mode has two layers. The native one is what the browser already knows: the visitor's
// `prefers-color-scheme`, the `color-scheme` that turns scrollbars and form controls dark, and
// the address bar color. The generated one is Dark Reader, which derives the night version of the
// site from its light styles. What both layers and the pre-paint script share lives here, and
// nothing in this module touches the DOM.

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** Cycle order of the toggle: follow the device first, then override it either way. */
export const preferences: readonly ThemePreference[] = ["system", "light", "dark"];

export const storageKey = "theme";

/** The address bar follows the page: paper by day, Ink by night. */
export const themeColor = { light: "#FFFFFF", dark: "#1A1216" } as const;

export function parsePreference(value: unknown): ThemePreference {
    return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
    if (preference === "system") return systemDark ? "dark" : "light";
    return preference;
}

export function nextPreference(preference: ThemePreference): ThemePreference {
    return preferences[(preferences.indexOf(preference) + 1) % preferences.length];
}

// The overlay is an OBS browser source: transparent, painted over a scene, never themed. It
// lives under `/chat/` (and `/v3/chat/` for links that are already in OBS scenes). The router
// matches paths case-insensitively, so this does too.
export const overlayPath = /^\/(?:v3\/)?chat(?:\/|$)/i;

// Runs in <head>, before the first paint, so a dark visitor never sees a white page: it settles
// the scheme, colors the address bar and holds the page back (`data-theme-pending`, see
// brand.css) until Dark Reader has painted. Plain ES5 without a bundler, so it stays a string;
// the three-second release is for a bundle that never arrives.
export const bootScript = `(function () {
    try {
        var root = document.documentElement;
        if (${overlayPath}.test(location.pathname)) return;
        var stored;
        try { stored = localStorage.getItem(${JSON.stringify(storageKey)}); } catch (error) {}
        var dark = stored === "dark" ||
            (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
        root.dataset.theme = dark ? "dark" : "light";
        var colors = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < colors.length; i++) {
            colors[i].content = dark ? ${JSON.stringify(themeColor.dark)} : ${JSON.stringify(themeColor.light)};
        }
        if (dark) {
            root.dataset.themePending = "";
            setTimeout(function () { delete root.dataset.themePending; }, 3000);
        }
    } catch (error) {}
})();`;
