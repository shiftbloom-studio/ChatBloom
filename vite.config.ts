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
        preset: "cloudflare-pages",
        // Pinned so builds are reproducible; bump deliberately to opt into new runtime behavior.
        compatibilityDate: "2026-09-29",
        // Develop on plain Node. The preset's default Cloudflare emulation would
        // auto-install Miniflare; the app only ever runs on Cloudflare remotely.
        devServer: {
            runner: "node-worker",
        },
        prerender: {
            routes: ["/v3"],
        },
    },
});
