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

// Limited to directives that cannot break the overlay: emotes and badges load from many
// third-party hosts, so there is no allowlist for images or connections.
const contentSecurityPolicy = "base-uri 'self'; form-action 'self'; object-src 'none'";

// Sent with static assets and with every response the Worker renders. The 400 that h3 returns
// for a malformed URL is produced before route rules run and does not carry them.
const securityHeaders = {
    // Framing is refused by default. The router matches paths case-insensitively and route
    // rules do not, so a deny rule for single paths could be bypassed with `/V3`.
    "content-security-policy": `${contentSecurityPolicy}; frame-ancestors 'none'`,
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
            routes: ["/", "/imprint", "/impressum", "/privacy", "/datenschutz"],
            // Emit `imprint.html` rather than `imprint/index.html`, so `/imprint` is served
            // as is instead of redirecting to `/imprint/`.
            autoSubfolderIndex: false,
        },
        plugins: ["./src/server/uncached-errors.ts"],
        handlers: [
            { route: "/**", middleware: true, handler: "./src/server/collapse-slashes.ts" },
            { route: "/**", middleware: true, handler: "./src/server/block-bots.ts" },
        ],
        routeRules: {
            "/**": { headers: securityHeaders },
            // For browsers that ignore `frame-ancestors`.
            "/": { headers: { "x-frame-options": "DENY" } },
            // The start page lived here before it moved to `/`. Permanent, so that search
            // engines carry what they know about the old address over to the new one.
            "/v3": { redirect: { to: "/", status: 301 } },
            "/v3/chat/**": {
                headers: {
                    // Overlay HTML must always be fresh, so it references the current assets.
                    "cache-control": "no-cache",
                    // Overlay pages stay embeddable, since streaming tools other than OBS load
                    // them in frames: the same policy without `frame-ancestors`.
                    "content-security-policy": contentSecurityPolicy,
                },
            },
            // Written for language models (src/lib/seo). The charset is named because the
            // text is not ASCII and a crawler has no page around it to guess from.
            "/llms.txt": { headers: { "content-type": "text/plain; charset=utf-8" } },
            "/llms-full.txt": { headers: { "content-type": "text/plain; charset=utf-8" } },
            // Unhashed fonts from `public/`. Hashed build assets are cached by Nitro's defaults.
            "/fonts/**": { headers: { "cache-control": "public, max-age=86400" } },
            "/v3/font/**": { headers: { "cache-control": "public, max-age=86400" } },
        },
    },
});
