import type { JSX, ParentProps } from "solid-js";

type SevenTVNamepaintProps = ParentProps<{
    /** Fallback text color, shown where the paint's background is transparent. */
    paintColor?: string;
    paintBackground: string;
    paintFilter?: string;
    style?: JSX.CSSProperties;
}>;

// TODO: Fetch 7TV cosmetics for a user (by `login`) with `createResource`
//   and derive the paint props from the result instead of passing them in.
export default function SevenTVNamepaint(props: SevenTVNamepaintProps) {
    return (
        <span
            style={{
                "-webkit-text-fill-color": "transparent",
                "background-clip": "text",
                "-webkit-background-clip": "text",
                "background-size": "cover",
                "background-color": "currentColor",
                "background-image": props.paintBackground,
                filter: props.paintFilter,
                color: props.paintColor,
                ...props.style,
            }}
        >
            {props.children}
        </span>
    );
}
