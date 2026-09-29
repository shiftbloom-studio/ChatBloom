import { defineHandler } from "nitro/h3";

import { isAutomated, isChatPage } from "./bots";

// Only the start page is meant for bots. A chat page shows the messages of a channel, so a
// crawler that reads it, or a script that opens it to reach the relay, is refused. The relay's
// own routes under `/api/` never reach Nitro and make the same check in the Worker entry.
export default defineHandler((event) => {
    if (!isChatPage(event.url.pathname)) return;

    // For crawlers that get past the check: keep chat pages out of search results and caches.
    event.res.headers.set("x-robots-tag", "noindex, nofollow, noarchive");

    if (isAutomated(event.req.headers.get("user-agent"))) {
        return new Response("Automated access to chat pages is not permitted.\n", {
            status: 403,
            headers: {
                "content-type": "text/plain; charset=utf-8",
                "x-robots-tag": "noindex, nofollow, noarchive",
            },
        });
    }
});
