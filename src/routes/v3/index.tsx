import { Link, Meta } from "@solidjs/meta";
import Container from "@suid/material/Container";
import Typography from "@suid/material/Typography";

import FeaturesGrid from "~/components/FeaturesGrid";
import MySiteTitle from "~/components/MySiteTitle";
import SetupHero from "~/components/SetupHero";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";

const url = "https://chat.shiftbloom.studio/v3";

export default function ChatSetup() {
    return (
        <>
            <MySiteTitle>Setup</MySiteTitle>
            <Link rel="canonical" href={url} />
            <Meta property="og:type" content="website" />
            <Meta property="og:site_name" content="ChatBloom" />
            <Meta property="og:url" content={url} />
            <Meta property="og:title" content="ChatBloom — put your chat on screen" />
            <Meta
                property="og:description"
                content="A Twitch chat overlay for streamers, from shiftbloom studio."
            />
            <Meta property="og:image" content="https://chat.shiftbloom.studio/og.png" />
            <Meta property="og:image:width" content="1200" />
            <Meta property="og:image:height" content="630" />
            <Meta
                property="og:image:alt"
                content="The shiftbloom Bloom beside the line: Put your chat on screen."
            />
            <Meta name="twitter:card" content="summary_large_image" />

            <SiteHeader />
            <main>
                <SetupHero />
                <Container
                    component="section"
                    aria-labelledby="features-title"
                    sx={{ pb: { xs: 10, md: 14 } }}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        01 / Features
                    </Typography>
                    <Typography id="features-title" variant="h2" sx={{ mb: { xs: 4, md: 6 } }}>
                        Some features.
                    </Typography>
                    <FeaturesGrid />
                </Container>
            </main>
            <SiteFooter />
        </>
    );
}
