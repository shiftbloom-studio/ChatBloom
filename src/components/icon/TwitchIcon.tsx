import SvgIcon, { type SvgIconProps } from "@suid/material/SvgIcon";

// Paths from the official Twitch brand assets (https://brand.twitch.tv/),
// "TwitchGlitchWhite.svg", reduced to the glyph so it inherits `currentColor`.
export default function TwitchIcon(props: SvgIconProps) {
    return (
        <SvgIcon viewBox="0 0 2400 2800" {...props}>
            <path d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z" />
            <rect x="1700" y="550" width="200" height="600" />
            <rect x="1150" y="550" width="200" height="600" />
        </SvgIcon>
    );
}
