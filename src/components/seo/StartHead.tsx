import { Link, Meta, Title } from "@solidjs/meta";

import SocialTags from "~/components/seo/SocialTags";
import { site, studio } from "~/lib/seo/site";
import { structuredDataJson } from "~/lib/seo/structured-data";

// Everything the start page says to machines: search engines, link previews and language
// models. The words come from src/lib/seo/site.ts, which the visible copy shares.
export default function StartHead() {
    return (
        <>
            <Title>{site.title}</Title>
            <Meta name="description" content={site.description} />
            <Link rel="canonical" href={site.url} />
            {/* Let results show the whole snippet and the large image. */}
            <Meta
                name="robots"
                content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
            />
            <Meta name="author" content={studio.name} />
            <Meta name="application-name" content={site.name} />
            <Meta name="apple-mobile-web-app-title" content={site.name} />

            <SocialTags
                title={site.socialTitle}
                description={site.socialDescription}
                url={site.url}
                facts={site.socialFacts}
            />

            {/* The same page as Markdown, for language models and their agents. */}
            <Link
                rel="alternate"
                type="text/markdown"
                href="/llms-full.txt"
                title={`${site.name} as Markdown`}
            />

            {/* The statement and the body text are the first things painted: fetch their fonts
                before the stylesheet asks for them. Overlay pages use neither. */}
            <Link
                rel="preload"
                as="font"
                type="font/woff2"
                href="/fonts/fontshare/clash-display-600.woff2"
                crossorigin="anonymous"
            />
            <Link
                rel="preload"
                as="font"
                type="font/woff2"
                href="/fonts/fontshare/general-sans-400.woff2"
                crossorigin="anonymous"
            />

            <script type="application/ld+json" innerHTML={structuredDataJson()} />
        </>
    );
}
