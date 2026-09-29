import { createTheme } from "@suid/material/styles";

// shiftbloom Brand Book v2.0, §05 Color: a white garden, one loud flower.
// Bloom Red does ten percent of the area and ninety percent of the talking;
// everything else is paper and ink. There is no second accent and no dark mode.
export const brand = {
    bloom: "#FF2E52",
    root: "#C81040",
    petal: "#FF8FAB",
    blush: "#FFE9EF",
    ink: "#1A1216",
    paper: "#FFFFFF",
} as const;

// §06 Typography: Clash Display makes the statements, General Sans does the
// explaining, JetBrains Mono keeps the books. The families live in brand.css.
const display = "var(--font-display)";
const sans = "var(--font-sans)";
const mono = "var(--font-mono)";

const type = (
    fontFamily: string,
    fontWeight: number,
    fontSize: string,
    lineHeight: number,
    letterSpacing = "0",
) => ({ fontFamily, fontWeight, fontSize, lineHeight, letterSpacing });

export const theme = createTheme({
    palette: {
        mode: "light",
        // Root Red is the hover state and the only red small text may wear.
        primary: {
            main: brand.bloom,
            dark: brand.root,
            light: brand.petal,
            contrastText: brand.paper,
        },
        secondary: { main: brand.ink, contrastText: brand.paper },
        text: {
            primary: brand.ink,
            secondary: "rgba(26, 18, 22, 0.6)",
            disabled: "rgba(26, 18, 22, 0.4)",
        },
        background: { default: brand.paper, paper: brand.paper },
        divider: "rgba(26, 18, 22, 0.12)",
        action: { active: brand.ink },
    },
    typography: {
        fontFamily: sans,
        // Display is tight (0.95–1.1), body is roomy (1.6–1.7). Never the other way around.
        h1: type(display, 600, "clamp(2.75rem, 7vw, 5.25rem)", 1.02, "-0.02em"),
        h2: type(display, 600, "clamp(2rem, 4.4vw, 3.25rem)", 1.05, "-0.02em"),
        h3: type(display, 600, "clamp(1.625rem, 3vw, 2.125rem)", 1.1, "-0.015em"),
        h4: type(display, 600, "1.625rem", 1.1, "-0.01em"),
        h5: type(display, 600, "1.375rem", 1.1, "-0.01em"),
        h6: type(display, 600, "1.125rem", 1.2),
        subtitle1: type(sans, 500, "1.125rem", 1.5),
        subtitle2: type(sans, 600, "0.9375rem", 1.5),
        body1: type(sans, 400, "1rem", 1.65),
        body2: type(sans, 400, "0.9375rem", 1.6),
        // Labels, specs and metadata wear mono. A label whispers: small caps, +16% tracking.
        button: type(mono, 600, "0.8125rem", 1.75, "0.08em"),
        caption: type(mono, 400, "0.75rem", 1.5, "0.02em"),
        overline: type(mono, 500, "0.71875rem", 1.6, "0.16em"),
    },
    shape: { borderRadius: 4 },
    components: {
        // Flat Bloom Red, no glow. The gradient lives inside the mark only.
        MuiButton: { defaultProps: { disableElevation: true } },
    },
});
