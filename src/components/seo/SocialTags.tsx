import { Meta } from "@solidjs/meta";
import { For } from "solid-js";

import { site } from "~/lib/seo/site";

type Locale = "en_US" | "de_DE";

type SocialTagsProps = {
    /** The line in bold. The platform adds the site's name, so the title can leave it out. */
    title: string;
    description: string;
    /** The page's own address, in full. */
    url: string;
    locale?: Locale;
    /** The language of the page's translation, if it has one. */
    alternateLocale?: Locale;
    /** Up to two facts that Slack lists under the description. */
    facts?: readonly { label: string; value: string }[];
};

// What a link to the page looks like where it is shared. Open Graph is read by nearly
// everything: Discord, Slack, WhatsApp, iMessage, Signal, Telegram, LinkedIn, Facebook,
// Mastodon, Bluesky and Teams. X reads the `twitter:` tags first, and Discord and Telegram take
// the large image from `twitter:card`.
//
// One image, not a list: previews show the first one they are given. @solidjs/meta also
// merges tags that share name and content, so a second image of the same width would take the
// first one's `og:image:width` away.
export default function SocialTags(props: SocialTagsProps) {
    return (
        <>
            <Meta property="og:type" content="website" />
            <Meta property="og:site_name" content={site.name} />
            <Meta property="og:locale" content={props.locale ?? "en_US"} />
            {props.alternateLocale && (
                <Meta property="og:locale:alternate" content={props.alternateLocale} />
            )}
            <Meta property="og:url" content={props.url} />
            <Meta property="og:title" content={props.title} />
            <Meta property="og:description" content={props.description} />
            <Meta property="og:image" content={site.image.url} />
            <Meta property="og:image:secure_url" content={site.image.url} />
            <Meta property="og:image:type" content={site.image.type} />
            <Meta property="og:image:width" content={String(site.image.width)} />
            <Meta property="og:image:height" content={String(site.image.height)} />
            <Meta property="og:image:alt" content={site.image.alt} />

            <Meta name="twitter:card" content="summary_large_image" />
            <Meta name="twitter:title" content={props.title} />
            <Meta name="twitter:description" content={props.description} />
            <Meta name="twitter:image" content={site.image.url} />
            <Meta name="twitter:image:alt" content={site.image.alt} />
            {/* X ignores these two pairs. Slack shows them as fields. */}
            <For each={props.facts?.slice(0, 2)}>
                {(fact, index) => (
                    <>
                        <Meta name={`twitter:label${index() + 1}`} content={fact.label} />
                        <Meta name={`twitter:data${index() + 1}`} content={fact.value} />
                    </>
                )}
            </For>
        </>
    );
}
