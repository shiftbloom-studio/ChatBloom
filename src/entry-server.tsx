// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
    <StartServer
        document={({ assets, children, scripts }) => (
            <html lang="en">
                <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <meta name="color-scheme" content="light" />
                    <meta name="theme-color" content="#FFFFFF" />
                    <meta
                        name="description"
                        content="ChatBloom is a Twitch chat overlay for streamers, from shiftbloom studio."
                    />
                    <link rel="icon" href="/favicon.ico" sizes="32x32" />
                    <link rel="icon" href="/bloom.svg" type="image/svg+xml" />
                    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
                    {/* Clash Display and General Sans come from Fontshare: the ITF Free Font
                        License allows self-hosting, but not redistributing the files in a
                        public repository. One family per request: combined requests only
                        return the first family. */}
                    <link rel="preconnect" href="https://api.fontshare.com" />
                    <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin="" />
                    <link
                        rel="stylesheet"
                        href="https://api.fontshare.com/v2/css?f[]=clash-display@400,600&display=swap"
                    />
                    <link
                        rel="stylesheet"
                        href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap"
                    />
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
