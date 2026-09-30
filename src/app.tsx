import "./brand.css";
import "./app.css";

import { MetaProvider, Title } from "@solidjs/meta";
import { Router, useIsRouting, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import CssBaseline from "@suid/material/CssBaseline";
import { ThemeProvider } from "@suid/material/styles";
import {
    catchError,
    createEffect,
    createSignal,
    getOwner,
    type JSX,
    runWithOwner,
    Show,
    Suspense,
    untrack,
} from "solid-js";
import { isServer } from "solid-js/web";

import { pageLanguage } from "~/lib/language";
import { ThemeSync } from "~/lib/theme/controller";
import { overlayPath } from "~/lib/theme/mode";
import { theme } from "~/theme";

// The server writes the language of the page it renders into `<html lang>` (entry-server.tsx), but
// that document stays when the router moves on to another page. This keeps it in step, so a screen
// reader reads the German legal pages in German once they are shown, and the English pages in
// English again when the visitor returns to them.
function DocumentLanguage() {
    const location = useLocation();
    createEffect(() => {
        document.documentElement.lang = pageLanguage(location.pathname);
    });
    return null;
}

// The server marks the document of an overlay path, so that OBS gets a transparent page before any
// script has run (entry-server.tsx, mode.ts). The chat route marks it too while it is mounted and
// unmarks it when it goes, but the 404 page under `/chat/` is an overlay path as well, and its link
// back to the start page must not take the mark along. So the mark follows the path, like the
// language does.
function OverlayMark() {
    const location = useLocation();
    createEffect(() => {
        const root = document.documentElement;
        if (overlayPath.test(location.pathname)) root.dataset.chatOverlay = "";
        else delete root.dataset.chatOverlay;
    });
    return null;
}

// Every deploy replaces the build. Its JavaScript chunks under `/_build/assets/` carry a hash of
// their content in their names, and the Worker answers a chunk of an earlier build with its 404
// page. A page that stays open across a deploy still refers to the chunks it was built with, and
// the router loads the component of a page the first time it is shown, so the first navigation to
// another page after a deploy asks for a chunk that is gone. The browser rejects that import and
// keeps the rejection for the life of the document (Chromium does not even ask the server again),
// so only a full load of the page, with the HTML of the current build, can show it.

// How browsers word the rejection of an import whose module, or a module it imports, did not load.
const chunkLoadFailures = [
    // Chromium, and so OBS.
    /^Failed to fetch dynamically imported module\b/,
    // Firefox.
    /^error loading dynamically imported module\b/,
    // Safari.
    /^Importing a module script failed\b/,
    // Vite, when a stylesheet that the chunk needs did not load.
    /^Unable to preload CSS for\b/,
];

function isChunkLoadError(error: unknown): boolean {
    return error instanceof Error && chunkLoadFailures.some((words) => words.test(error.message));
}

// The address this document was loaded from, before the router moved on.
const loadedFrom = isServer ? "" : document.URL;

function withoutFragment(address: string): string {
    const url = new URL(address);
    url.hash = "";
    return url.href;
}

// Shows a page whose chunks are gone after a deploy with a full load of it, where SolidStart would
// show its exception page.
function StaleBuild(props: { children: JSX.Element }) {
    // Chunks only fail in the browser. Catching there adds nothing to the HTML of the server, unlike
    // an <ErrorBoundary>, so the pages render and hydrate exactly as they did without this.
    if (isServer) return props.children;

    const location = useLocation();
    const routing = useIsRouting();
    const around = getOwner();
    const [failed, setFailed] = createSignal(false);
    // When the page could not be shown and a full load could loop.
    const [stuck, setStuck] = createSignal(false);

    // The failed import reaches this as the error of the page that needed it. Vite's own signal,
    // the `vite:preloadError` event, cannot tell that page: it also fires when the router merely
    // preloads the page of a link under the pointer, and cancelling it resolves the import with
    // nothing instead of a module.
    const pages = catchError(
        () => props.children,
        (error) => {
            if (isChunkLoadError(error)) setFailed(true);
            // Everything else goes on to SolidStart's boundary around the app, as it did before.
            else
                runWithOwner(around, () => {
                    throw error;
                });
        },
    );

    // The router ends a navigation whose chunk failed as well: it shows the failed page and only
    // then writes its address into the history. Waiting for that lets the full load take the entry
    // that the router made for the page, so Back still leads to the page the visitor came from.
    // Back and Forward themselves have set the address before the router even starts.
    createEffect(() => {
        if (!failed() || routing()) return;
        setFailed(false);
        untrack(() => {
            const here = window.location;
            const target = new URL(location.pathname + location.search + location.hash, here.href);
            const page = withoutFragment(target.href);
            if (page === withoutFragment(loadedFrom)) {
                // Then the chunks that failed came with the HTML that a full load of the page would
                // fetch, and loading it again could fail the same way, over and over. So a full load
                // only ever follows a navigation within the document, never the load of one: that is
                // what keeps it from looping, without a note in browser storage.
                setStuck(true);
            } else if (page === withoutFragment(here.href)) {
                // Assigning an address that differs from the current one only in its fragment would
                // scroll within the document instead of loading it.
                if (here.href !== target.href) history.replaceState(history.state, "", target);
                here.reload();
            } else {
                here.assign(target);
            }
        });
    });
    // Leaving the page leaves the notice behind; the next page may well load.
    createEffect(() => routing() && setStuck(false));

    return (
        <>
            {pages}
            {/* Nothing on an overlay, which OBS paints over the stream for everyone to see. */}
            <Show when={stuck() && !overlayPath.test(location.pathname)}>
                <main class="stale-build" lang="en">
                    <div class="stale-build-seed" aria-hidden="true" />
                    <p class="stale-build-overline">Not loaded</p>
                    <h1 class="stale-build-title">This bud didn't open.</h1>
                    <p class="stale-build-lede" role="alert">
                        Part of this page did not arrive, perhaps because Petal was updated just
                        now. Loading it again usually helps.
                    </p>
                    <button
                        type="button"
                        class="seed-link stale-build-reload"
                        onClick={() => window.location.reload()}
                    >
                        Load it again
                    </button>
                </main>
            </Show>
        </>
    );
}

export default function App() {
    return (
        <Router
            root={(props) => (
                <MetaProvider>
                    <Title>Petal — Twitch chat overlay by shiftbloom studio</Title>
                    <DocumentLanguage />
                    <OverlayMark />
                    <ThemeSync />
                    <ThemeProvider theme={theme}>
                        <CssBaseline />
                        <StaleBuild>
                            <Suspense>{props.children}</Suspense>
                        </StaleBuild>
                    </ThemeProvider>
                </MetaProvider>
            )}
        >
            <FileRoutes />
        </Router>
    );
}
