import { definePlugin } from "nitro";

// Route rules in `vite.config.ts` set long-lived `cache-control` headers by path, and those
// also land on error responses for that path. A cached 404 for an asset URL would outlive
// the deployment that makes the URL valid, so error responses rendered by the Worker are never
// cached. Responses that Cloudflare's asset layer produces itself (the bare 404 for files
// excluded by `.assetsignore`, 405 for other methods on a static file) do not pass through
// this hook.
export default definePlugin((nitroApp) => {
    nitroApp.hooks.hook("response", (response) => {
        if (response.status >= 400) {
            response.headers.set("cache-control", "no-store");
        }
    });
});
