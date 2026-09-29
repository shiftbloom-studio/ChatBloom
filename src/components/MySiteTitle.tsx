import { Title } from "@solidjs/meta";

// A single string: <title> only holds text, and mixed children would be
// stringified with commas during SSR ("#,channel").
export default function MySiteTitle(props: { children: string }) {
    return <Title>{`${props.children} — Petal`}</Title>;
}
