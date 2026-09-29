import Container from "@suid/material/Container";
import Typography from "@suid/material/Typography";
import { onMount } from "solid-js";

import FeaturesGrid from "~/components/FeaturesGrid";
import SetupHero from "~/components/SetupHero";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";
import StartHead from "~/components/seo/StartHead";
import Configurator from "~/components/setup/Configurator";
import { createSetup } from "~/components/setup/store";
import Questions from "~/components/start/Questions";
import Steps from "~/components/start/Steps";

// Sections that links lead to stop a little below the edge of the window.
const section = { pb: { xs: 10, md: 14 }, scrollMarginTop: "32px" };
const heading = { mb: { xs: 4, md: 6 } };

// The start page, and the only page that is meant to be found. Its title, description and
// structured data are in StartHead; the headings below say what each section answers, because
// search engines and language models read them as the outline of the page.
//
// It is also where an overlay is set up. The hero's channel field and the section `setup`
// share one state, so both show and copy the same link.
export default function Start() {
    const setup = createSetup();
    onMount(() => setup.setOrigin(window.location.origin));

    return (
        <>
            <StartHead />
            <SiteHeader />
            <main>
                <SetupHero setup={setup} />
                <Container
                    component="section"
                    id="setup"
                    aria-labelledby="setup-title"
                    sx={section}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        01 / Look
                    </Typography>
                    <Typography id="setup-title" variant="h2" sx={heading}>
                        Choose the look.
                    </Typography>
                    <Configurator setup={setup} />
                </Container>
                <Container
                    component="section"
                    id="how-it-works"
                    aria-labelledby="steps-title"
                    sx={section}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        02 / How it works
                    </Typography>
                    <Typography id="steps-title" variant="h2" sx={heading}>
                        Twitch chat in OBS, in three steps.
                    </Typography>
                    <Steps />
                </Container>
                <Container
                    component="section"
                    id="features"
                    aria-labelledby="features-title"
                    sx={section}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        03 / Features
                    </Typography>
                    <Typography id="features-title" variant="h2" sx={heading}>
                        Emotes, badges and name paints.
                    </Typography>
                    <FeaturesGrid />
                </Container>
                <Container
                    component="section"
                    id="questions"
                    aria-labelledby="questions-title"
                    sx={section}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        04 / Questions
                    </Typography>
                    <Typography id="questions-title" variant="h2" sx={heading}>
                        Questions, answered.
                    </Typography>
                    <Questions />
                </Container>
            </main>
            <SiteFooter />
        </>
    );
}
