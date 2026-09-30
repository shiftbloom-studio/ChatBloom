// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

import { pageLanguage } from "~/lib/language";
import { bootScript, overlayPath, overlayStyle, themeColor } from "~/lib/theme/mode";

export default createHandler((event) => {
    const { pathname } = new URL(event.request.url);
    // An OBS overlay is transparent from its first paint, without waiting for a script (mode.ts).
    const overlay = overlayPath.test(pathname);
    return (
        <StartServer
            document={({ assets, children, scripts }) => (
                <html lang={pageLanguage(pathname)} data-chat-overlay={overlay ? "" : undefined}>
                    <head>
                        <meta charset="utf-8" />
                        <meta name="viewport" content="width=device-width, initial-scale=1" />
                        <meta name="color-scheme" content="light dark" />
                        <meta
                            name="theme-color"
                            content={themeColor.light}
                            media="(prefers-color-scheme: light)"
                        />
                        <meta
                            name="theme-color"
                            content={themeColor.dark}
                            media="(prefers-color-scheme: dark)"
                        />
                        {overlay && <style innerHTML={overlayStyle} />}
                        <script innerHTML={bootScript} />
                        {/* No description here: a page that is meant to be found brings its own
                            (src/components/seo), and two of them would contradict each other. */}
                        <link rel="icon" href="/favicon.ico" sizes="32x32" />
                        <link rel="icon" href="/bloom.svg" type="image/svg+xml" />
                        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
                        {assets}
                    </head>
                    <body>
                        <div id="app">{children}</div>
                        {scripts}
                    </body>
                </html>
            )}
        />
    );
});
