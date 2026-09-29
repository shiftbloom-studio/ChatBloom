import { useParams } from "@solidjs/router";

import MySiteTitle from "~/components/MySiteTitle";

export default function Chat() {
    const params = useParams<{ channel: string }>();

    return (
        <>
            <MySiteTitle>{`#${params.channel}`}</MySiteTitle>
            <main />
        </>
    );
}
