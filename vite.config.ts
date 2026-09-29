import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// SUID ships uncompiled Solid JSX, so it must go through the Solid compiler
// instead of being pre-bundled (dev) or externalized (SSR).
const suidPackages = [
    "@suid/base",
    "@suid/css",
    "@suid/material",
    "@suid/styled-engine",
    "@suid/system",
    "@suid/types",
    "@suid/utils",
];

// Sent with every response, both static assets and Worker-rendered pages. The CSP is limited to
// directives that cannot break the overlay; emotes and badges load from many third-party hosts.
const securityHeaders = {
    "content-security-policy": "base-uri 'self'; form-action 'self'; object-src 'none'",
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
};

export default defineConfig({
    plugins: [solidStart(), nitro()],
    build: {
        // Never inline fonts as base64: it bloats the render-blocking CSS with
        // subsets that `unicode-range` would otherwise only fetch on demand.
        assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    },
    optimizeDeps: {
        exclude: suidPackages,
        // @solidjs/start is excluded from pre-bundling (it ships JSX), so the UMD dependency
        // of its dev overlay's error viewer must be pre-bundled explicitly to load in dev.
        include: ["@solidjs/start > @jridgewell/trace-mapping"],
    },
    ssr: {
        noExternal: suidPackages,
    },
    nitro: {
        // Cloudflare Workers with static assets. Files in `.output/public` are served by
        // Cloudflare directly; the Worker only renders what is not a static file.
        preset: "cloudflare-module",
        // Pinned so builds are reproducible; bump deliberately to opt into new runtime behavior.
        compatibilityDate: "2026-09-29",
        // Develop on plain Node. The preset's default Cloudflare emulation would
        // auto-install Miniflare; the app only ever runs on Cloudflare remotely.
        devServer: {
            runner: "node-worker",
        },
        prerender: {
            routes: ["/v3", "/imprint", "/impressum", "/privacy", "/datenschutz"],
            // Emit `v3.html` rather than `v3/index.html`, so `/v3` is served as is
            // instead of redirecting to `/v3/`.
            autoSubfolderIndex: false,
        },
        plugins: ["./src/server/uncached-errors.ts"],
        routeRules: {
            "/**": { headers: securityHeaders },
            // There is no index page yet.
            "/": { redirect: { to: "/v3", status: 302 } },
            // The setup page must not be framed. Overlay pages stay embeddable, since
            // streaming tools other than OBS load them in frames.
            "/v3": { headers: { "x-frame-options": "DENY" } },
            // Overlay HTML must always be fresh, so it references the current assets.
            "/v3/chat/**": { headers: { "cache-control": "no-cache" } },
            // Unhashed fonts from `public/`. Hashed build assets are cached by Nitro's defaults.
            "/fonts/**": { headers: { "cache-control": "public, max-age=86400" } },
            "/v3/font/**": { headers: { "cache-control": "public, max-age=86400" } },
        },
    },
});
