// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

import { bootScript, themeColor } from "~/lib/theme/mode";

export default createHandler(() => (
    <StartServer
        document={({ assets, children, scripts }) => (
            <html lang="en">
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
));
