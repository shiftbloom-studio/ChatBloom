import { solidStart } from "@solidjs/start/config";
import type { Nitro } from "nitro/types";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

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
    // rules do not, so a deny rule for single paths could be bypassed with `/Privacy`.
    "content-security-policy": `${contentSecurityPolicy}; frame-ancestors 'none'`,
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
};

const overlayHeaders = {
    // Overlay HTML must always be fresh, so it references the current assets.
    "cache-control": "no-cache",
    // Overlay pages stay embeddable, since the start page previews them in a frame and
    // streaming tools other than OBS load them in frames: the same policy without
    // `frame-ancestors`.
    "content-security-policy": contentSecurityPolicy,
};

// Puts `src/worker/entry.ts` in front of the Worker that Nitro's preset builds. The entry
// exports the Durable Object classes and answers `/api/` itself. Development and the
// prerenderer run on Node, where there are no Durable Objects, and keep Nitro's own entry.
function workerEntry(nitro: Nitro): void {
    if (nitro.options.dev || nitro.options.preset !== "cloudflare-module") return;
    nitro.options.alias["#petal/nitro-worker"] = nitro.options.entry;
    nitro.options.entry = `${nitro.options.rootDir}src/worker/entry.ts`;
}

// The parts of Node's upgrade event that are used here; the project has no Node typings.
type UpgradeRequest = { url?: string };
type UpgradeSocket = { end(data: string): void };

const RELAY_UNAVAILABLE = '{"error":"The chat relay only runs on Cloudflare"}';

// `vite dev` runs on Node, where the relay and the data gateway do not exist. Without this,
// requests to `/api/` render the 404 page and WebSocket upgrades are never answered. Refusing
// both at once sends the overlay to its direct connections without waiting for a timeout.
function relayUnavailable(): Plugin {
    return {
        name: "petal:relay-unavailable",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/api", (_request, response) => {
                response.writeHead(503, {
                    "cache-control": "no-store",
                    "content-type": "application/json; charset=utf-8",
                });
                response.end(RELAY_UNAVAILABLE);
            });
            server.httpServer?.on("upgrade", (request: UpgradeRequest, socket: UpgradeSocket) => {
                if (request.url?.startsWith("/api/")) {
                    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
                }
            });
        },
    };
}

export default defineConfig({
    plugins: [relayUnavailable(), solidStart(), nitro()],
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
        modules: [workerEntry],
        handlers: [
            { route: "/**", middleware: true, handler: "./src/server/collapse-slashes.ts" },
            { route: "/**", middleware: true, handler: "./src/server/block-bots.ts" },
        ],
        routeRules: {
            "/**": { headers: securityHeaders },
            // For browsers that ignore `frame-ancestors`.
            "/": { headers: { "x-frame-options": "DENY" } },
            // The setup is a section of the start page. Not permanent: a browser would keep
            // a 301 even if this became a page again.
            "/setup": { redirect: { to: "/#setup", status: 302 } },
            "/chat/**": { headers: overlayHeaders },
            // Written for language models (src/lib/seo). The charset is named because the
            // text is not ASCII and a crawler has no page around it to guess from.
            "/llms.txt": { headers: { "content-type": "text/plain; charset=utf-8" } },
            "/llms-full.txt": { headers: { "content-type": "text/plain; charset=utf-8" } },
            // Unhashed fonts from `public/`. Hashed build assets are cached by Nitro's defaults.
            "/fonts/**": { headers: { "cache-control": "public, max-age=86400" } },
        },
    },
});
