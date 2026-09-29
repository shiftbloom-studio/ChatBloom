// The start page as schema.org data (JSON-LD): what Petal is, who makes it, how it is set up and
// the questions the page answers. Search engines and language models read this instead of
// guessing from the markup. Built from the same module as the visible copy, because structured
// data that says something the page does not is treated as spam.

import { features, origins, questions, site, steps, studio } from "./site";

const id = (fragment: string) => `${site.url}#${fragment}`;
const studioId = `${studio.url}/#organization`;

export function structuredData() {
    const image = {
        "@type": "ImageObject",
        "@id": id("image"),
        url: site.image.url,
        contentUrl: site.image.url,
        width: site.image.width,
        height: site.image.height,
        caption: site.image.alt,
    };

    const organization = {
        "@type": "Organization",
        "@id": studioId,
        name: studio.name,
        url: studio.url,
        description: studio.description,
        email: studio.email,
        logo: site.icon,
        sameAs: studio.profiles,
    };

    const website = {
        "@type": "WebSite",
        "@id": id("website"),
        name: site.name,
        alternateName: site.alternateNames,
        url: site.url,
        description: site.description,
        inLanguage: site.language,
        publisher: { "@id": studioId },
    };

    const application = {
        "@type": "WebApplication",
        "@id": id("app"),
        name: site.name,
        alternateName: site.alternateNames,
        url: site.url,
        description: site.summary,
        applicationCategory: "MultimediaApplication",
        applicationSubCategory: "Twitch chat overlay",
        operatingSystem: "Any",
        browserRequirements:
            "Requires JavaScript. Runs in OBS Studio browser sources and in current browsers.",
        featureList: features,
        isAccessibleForFree: true,
        offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "EUR",
            availability: "https://schema.org/InStock",
        },
        image: { "@id": id("image") },
        screenshot: { "@id": id("image") },
        license: site.license.url,
        inLanguage: site.language,
        author: { "@id": studioId },
        publisher: { "@id": studioId },
        isBasedOn: {
            "@type": "SoftwareSourceCode",
            name: origins.name,
            codeRepository: origins.repository,
            author: { "@type": "Person", name: origins.author },
        },
        sameAs: [site.repository],
    };

    const source = {
        "@type": "SoftwareSourceCode",
        "@id": id("source"),
        name: `${site.name} source code`,
        codeRepository: site.repository,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Cloudflare Workers",
        license: site.license.url,
        targetProduct: { "@id": id("app") },
        author: { "@id": studioId },
    };

    // The page is an ordinary page and a list of questions at once.
    const page = {
        "@type": ["WebPage", "FAQPage"],
        "@id": id("page"),
        url: site.url,
        name: site.title,
        description: site.description,
        inLanguage: site.language,
        dateModified: site.updated,
        isPartOf: { "@id": id("website") },
        about: { "@id": id("app") },
        primaryImageOfPage: { "@id": id("image") },
        mainEntity: questions.map((entry) => ({
            "@type": "Question",
            name: entry.question,
            acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
    };

    const howTo = {
        "@type": "HowTo",
        "@id": id("how-to"),
        name: "How to add Twitch chat to OBS with Petal",
        description:
            "Put live Twitch chat on stream as a browser source, with 7TV, BTTV and FFZ emotes.",
        inLanguage: site.language,
        totalTime: "PT1M",
        tool: [
            {
                "@type": "HowToTool",
                name: "OBS Studio, or other streaming software with a browser source",
            },
        ],
        step: steps.map((step, index) => ({
            "@type": "HowToStep",
            position: index + 1,
            name: step.title.replace(/\.$/, ""),
            text: step.text,
            url: id("how-it-works"),
        })),
    };

    return {
        "@context": "https://schema.org",
        "@graph": [organization, website, page, application, source, howTo, image],
    };
}

/**
 * For a `<script type="application/ld+json">`. `<` is escaped so that no string in the data can
 * close the script element.
 */
export function structuredDataJson(): string {
    return JSON.stringify(structuredData()).replace(/</g, "\\u003c");
}
