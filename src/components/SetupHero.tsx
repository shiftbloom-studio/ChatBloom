import Typography from "@suid/material/Typography";

import Bloom from "~/components/brand/Bloom";
import Sprinkles from "~/components/brand/Sprinkles";
import OverlayLink from "~/components/OverlayLink";
import type { Setup } from "~/components/setup/store";
import styles from "./SetupHero.module.css";

// One page, one flower, one promise: the flower opens the page, the statement
// carries it, the setup field ends it, and the sky stays in the margins.
// Nothing else speaks here: a streamer who opens the page for the first time
// is asked one thing, the channel.
export default function SetupHero(props: { setup: Setup }) {
    return (
        <section class={styles.hero} aria-labelledby="start-title">
            <Sprinkles />
            <Bloom alive class={styles.bloom} />
            <Typography id="start-title" variant="h1" sx={{ maxWidth: "12ch", mx: "auto" }}>
                Put your <span class={styles.red}>chat</span> on screen.
            </Typography>
            <Typography variant="subtitle1" component="p" sx={{ mt: 3 }}>
                Petal is a free, open-source Twitch chat overlay for OBS.
            </Typography>
            <OverlayLink setup={props.setup} />
        </section>
    );
}
