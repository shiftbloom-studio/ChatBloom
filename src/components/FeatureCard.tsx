import Card from "@suid/material/Card";
import CardContent from "@suid/material/CardContent";
import Typography from "@suid/material/Typography";
import type { JSX, ParentProps } from "solid-js";

type FeatureCardProps = ParentProps<{
    /** Numbers are data, and data wears mono. */
    number: string;
    title: JSX.Element;
}>;

// Flat, hairline-bordered and square: paper and ink, no shadow.
export default function FeatureCard(props: FeatureCardProps) {
    return (
        <Card variant="outlined" sx={{ minWidth: 275 }}>
            <CardContent sx={{ p: 3 }}>
                <Typography variant="overline" component="p" color="primary.dark">
                    {props.number}
                </Typography>
                <Typography variant="h5" component="h3" sx={{ mb: 1.5 }}>
                    {props.title}
                </Typography>
                {props.children}
            </CardContent>
        </Card>
    );
}
