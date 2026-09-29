import { HttpStatusCode } from "@solidjs/start";
import Box from "@suid/material/Box";
import Container from "@suid/material/Container";
import Typography from "@suid/material/Typography";

import MySiteTitle from "~/components/MySiteTitle";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";

export default function NotFound() {
    return (
        <>
            <MySiteTitle>Not found</MySiteTitle>
            <HttpStatusCode code={404} />
            <SiteHeader />
            <Container component="main" sx={{ py: { xs: 10, md: 16 }, textAlign: "center" }}>
                {/* Below the smallest bloom, only the seed remains. */}
                <Box
                    aria-hidden="true"
                    sx={{
                        width: 28,
                        height: 28,
                        mx: "auto",
                        mb: 5,
                        borderRadius: "50%",
                        // The variable, so the seed keeps its red at night (src/lib/theme).
                        bgcolor: "var(--bloom)",
                    }}
                />
                <Typography variant="overline" component="p" color="text.secondary">
                    404 — not found
                </Typography>
                <Typography variant="h1" sx={{ maxWidth: "12ch", mx: "auto" }}>
                    Nothing grows here.
                </Typography>
                <Typography variant="subtitle1" component="p" sx={{ mt: 3 }}>
                    This page doesn't exist, or it hasn't sprouted yet.
                </Typography>
                <Typography variant="button" component="p" sx={{ mt: 5 }}>
                    <a class="seed-link" href="/v3">
                        Back to setup
                    </a>
                </Typography>
            </Container>
            <SiteFooter />
        </>
    );
}
