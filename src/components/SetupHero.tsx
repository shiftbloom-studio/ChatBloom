import Typography from "@suid/material/Typography";

import Bloom from "~/components/brand/Bloom";
import Sprinkles from "~/components/brand/Sprinkles";
import OverlayLink from "~/components/OverlayLink";
import styles from "./SetupHero.module.css";

// One page, one flower, one promise: the flower opens the page, the statement
// carries it, the setup field ends it, and the sky stays in the margins.
export default function SetupHero() {
    return (
        <section class={styles.hero} aria-labelledby="setup-title">
            <Sprinkles />
            <Bloom alive class={styles.bloom} />
            <Typography variant="overline" component="p" color="text.secondary">
                ChatBloom — setup
            </Typography>
            <Typography id="setup-title" variant="h1" sx={{ maxWidth: "12ch", mx: "auto" }}>
                Put your <span class={styles.red}>chat</span> on screen.
            </Typography>
            <Typography variant="subtitle1" component="p" sx={{ mt: 3 }}>
                ChatBloom is a Twitch chat overlay for streamers.
            </Typography>
            <OverlayLink />
            <p class={styles.vertical}>
                An open call for contributors, volunteers and curious coders
            </p>
        </section>
    );
}
