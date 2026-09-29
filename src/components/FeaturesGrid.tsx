import Grid from "@suid/material/Grid";
import List from "@suid/material/List";
import ListItem from "@suid/material/ListItem";
import ListItemIcon from "@suid/material/ListItemIcon";
import ListItemText from "@suid/material/ListItemText";
import Stack from "@suid/material/Stack";
import type { SvgIconProps } from "@suid/material/SvgIcon";
import Typography from "@suid/material/Typography";
import { type Component, For } from "solid-js";

import FeatureCard from "~/components/FeatureCard";
import BTTVIcon from "~/components/icon/BTTVIcon";
import ChatterinoIcon from "~/components/icon/ChatterinoIcon";
import FFZIcon from "~/components/icon/FFZIcon";
import SevenTVIcon from "~/components/icon/SevenTVIcon";
import TwitchIcon from "~/components/icon/TwitchIcon";
import SevenTVNamepaint from "~/components/SevenTVNamepaint";

type Provider = {
    name: string;
    note?: string;
    Icon: Component<SvgIconProps>;
};

const twitch: Provider = { name: "Twitch", Icon: TwitchIcon };
const sevenTV: Provider = { name: "7TV", Icon: SevenTVIcon };
const bttv: Provider = { name: "BTTV", Icon: BTTVIcon };
const ffz: Provider = { name: "FFZ", Icon: FFZIcon };

const emoteProviders = [twitch, sevenTV, bttv, ffz];

const badgeProviders = [
    twitch,
    sevenTV,
    bttv,
    { ...ffz, note: "And FFZ:AP too." },
    { name: "Chatterino", Icon: ChatterinoIcon },
];

// Provider logos are glyphs, and glyphs wear ink. Rows are ruled with hairlines.
function ProviderList(props: { providers: Provider[] }) {
    return (
        <List dense disablePadding sx={{ mt: 2 }}>
            <For each={props.providers}>
                {(provider) => (
                    <ListItem
                        disableGutters
                        sx={{ borderTop: "1px solid", borderColor: "divider" }}
                    >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <provider.Icon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                            primary={provider.name}
                            secondary={provider.note}
                            primaryTypographyProps={{ fontWeight: 500 }}
                            secondaryTypographyProps={{ variant: "caption" }}
                        />
                    </ListItem>
                )}
            </For>
        </List>
    );
}

export default function FeaturesGrid() {
    return (
        <Grid container spacing={3}>
            <Grid item md={4} sm={6} xs={12}>
                <Stack direction="column" spacing={3}>
                    <FeatureCard number="01" title="Emotes.">
                        <Typography variant="body1">Supported emote providers:</Typography>
                        <ProviderList providers={emoteProviders} />
                    </FeatureCard>

                    <FeatureCard number="02" title="Name paints.">
                        <Typography variant="body1">
                            Say hello to name paints from 7TV, like{" "}
                            <SevenTVNamepaint
                                style={{ "font-weight": 700 }}
                                paintColor="#d7b030"
                                paintBackground="radial-gradient(circle, rgba(215, 176, 48, 1) 0%, rgba(255, 247, 182, 1) 100%)"
                                paintFilter="drop-shadow(0.6px 0px 0.2px rgba(120, 120, 120, 1)) drop-shadow(-0.6px 0px 0.2px rgba(120, 120, 120, 1)) drop-shadow(0px 0.6px 0.2px rgba(120, 120, 120, 1)) drop-shadow(0px -0.6px 0.2px rgba(120, 120, 120, 1)) drop-shadow(0px 0px 1.5px rgba(120, 120, 120, 1))"
                            >
                                Festive Gold
                            </SevenTVNamepaint>
                            ,{" "}
                            <SevenTVNamepaint
                                style={{ "font-weight": 700 }}
                                paintBackground="linear-gradient(360deg, rgba(10, 182, 255, 1) 0%, rgba(10, 182, 255, 1) 25%, rgba(153, 224, 255, 1) 25%, rgba(153, 224, 255, 1) 50%, rgba(153, 0, 255, 1) 50%, rgba(153, 0, 255, 1) 75%, rgba(255, 0, 200, 1) 75%)"
                                paintFilter="drop-shadow(0px 0px 1px rgba(255, 102, 102, 1))"
                            >
                                80's Pool
                            </SevenTVNamepaint>{" "}
                            and many more.
                        </Typography>
                    </FeatureCard>
                </Stack>
            </Grid>

            <Grid item md={4} sm={6} xs={12}>
                <FeatureCard number="03" title="Badges.">
                    <Typography variant="body1">Supported badge providers:</Typography>
                    <ProviderList providers={badgeProviders} />
                </FeatureCard>
            </Grid>

            <Grid item md={4} sm={6} xs={12}>
                <Stack direction="column" spacing={3}>
                    <FeatureCard number="04" title="Fonts.">
                        <Typography variant="body1">
                            Any font you have on your system can be used. We have some sweet
                            defaults too, like the{" "}
                            <span style={{ "font-family": "Alsina", "font-size": "1.2em" }}>
                                VSauce font
                            </span>
                            .
                        </Typography>
                    </FeatureCard>

                    <FeatureCard number="05" title="Hide bot messages.">
                        <Typography variant="body2" gutterBottom color="text.secondary">
                            And commands.
                        </Typography>
                        <Typography variant="body1">
                            Hide messages from bots and messages with commands. No more gambling
                            spam in your chat.
                        </Typography>
                    </FeatureCard>
                </Stack>
            </Grid>
        </Grid>
    );
}
