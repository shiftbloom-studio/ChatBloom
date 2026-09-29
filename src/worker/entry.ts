import nitroWorker from "#petal/nitro-worker";
import { handleApi } from "./api";
import type { Env } from "./env";

// Wrangler looks for Durable Object classes among the exports of the Worker's main module.
export { ChatHub } from "./hub";

// `/api/` is answered here and never reaches Nitro. h3 rebuilds each response to add the
// route-rule headers, and a rebuilt WebSocket upgrade response has lost its socket.
export default {
    ...nitroWorker,
    fetch(request, env, context) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/")) {
            return handleApi(request, env, context, url);
        }
        return nitroWorker.fetch(request, env, context);
    },
} satisfies ExportedHandler<Env>;
