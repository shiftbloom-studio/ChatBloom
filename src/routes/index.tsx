import Container from "@suid/material/Container";
import Typography from "@suid/material/Typography";

import FeaturesGrid from "~/components/FeaturesGrid";
import SetupHero from "~/components/SetupHero";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";
import StartHead from "~/components/seo/StartHead";
import Questions from "~/components/start/Questions";
import Steps from "~/components/start/Steps";

const section = { pb: { xs: 10, md: 14 } };
const heading = { mb: { xs: 4, md: 6 } };

// The start page, and the only page that is meant to be found. Its title, description and
// structured data are in StartHead; the headings below say what each section answers, because
// search engines and language models read them as the outline of the page.
export default function Start() {
    return (
        <>
            <StartHead />
            <SiteHeader />
            <main>
                <SetupHero />
                <Container
                    component="section"
                    id="how-it-works"
                    aria-labelledby="steps-title"
                    sx={section}
                >
                    <Typography variant="overline" component="p" color="primary.dark">
                        01 / How it works
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
                        02 / Features
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
                        03 / Questions
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
