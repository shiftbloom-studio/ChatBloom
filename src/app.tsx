import "./brand.css";
import "./app.css";

import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import CssBaseline from "@suid/material/CssBaseline";
import { ThemeProvider } from "@suid/material/styles";
import { Suspense } from "solid-js";

import { ThemeSync } from "~/lib/theme/controller";
import { theme } from "~/theme";

export default function App() {
    return (
        <Router
            root={(props) => (
                <MetaProvider>
                    <Title>ChatBloom — Twitch chat overlay by shiftbloom studio</Title>
                    <ThemeSync />
                    <ThemeProvider theme={theme}>
                        <CssBaseline />
                        <Suspense>{props.children}</Suspense>
                    </ThemeProvider>
                </MetaProvider>
            )}
        >
            <FileRoutes />
        </Router>
    );
}
