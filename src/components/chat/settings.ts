import { createContext, useContext } from "solid-js";

import { DEFAULT_SETTINGS, type OverlaySettings } from "~/lib/overlay/settings";

// An accessor rather than the settings themselves, so a changed query string also reaches the
// lines that are already on screen.
const SettingsContext = createContext<() => OverlaySettings>(() => DEFAULT_SETTINGS);

export const SettingsProvider = SettingsContext.Provider;

export function useSettings(): () => OverlaySettings {
    return useContext(SettingsContext);
}
