import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { files } from "../src/lib/seo/files";
import { features, questions, site, steps } from "../src/lib/seo/site";
import { structuredData, structuredDataJson } from "../src/lib/seo/structured-data";

const published = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("what the start page says about itself", () => {
    it("fits into a search result", () => {
        assert.ok(site.title.length <= 60, `title has ${site.title.length} characters`);
        assert.ok(
            site.description.length >= 110 && site.description.length <= 160,
            `description has ${site.description.length} characters`,
        );
        assert.ok(site.socialTitle.length <= 60);
        assert.ok(site.socialDescription.length <= 160);
    });

    it("names the product and what it is for in title and description", () => {
        for (const text of [site.title, site.description]) {
            for (const word of [site.name, "Twitch chat overlay", "OBS"]) {
                assert.ok(text.includes(word), `"${word}" is missing in "${text}"`);
            }
        }
    });

    it("lives at one address, the root of the site", () => {
        assert.equal(site.url, `${site.origin}/`);
        assert.ok(site.image.url.startsWith(`${site.origin}/`));
    });

    it("answers every question in whole sentences that stand on their own", () => {
        assert.ok(questions.length >= 5);
        for (const entry of questions) {
            assert.match(entry.question, /\?$/);
            assert.match(entry.answer, /\.$/);
            // An answer is quoted without the page around it.
            assert.doesNotMatch(entry.answer, /\b(this page|above|below)\b/i, entry.question);
        }
        assert.equal(new Set(questions.map((entry) => entry.question)).size, questions.length);
    });
});

describe("structured data", () => {
    const graph: Record<string, unknown>[] = structuredData()["@graph"];
    const node = (type: string) => {
        const found = graph.find((entry) => [entry["@type"]].flat().includes(type));
        assert.ok(found, `no ${type} in the graph`);
        return found;
    };

    it("describes the site, the app, its source, its maker and the page", () => {
        for (const type of [
            "Organization",
            "WebSite",
            "WebPage",
            "FAQPage",
            "WebApplication",
            "SoftwareSourceCode",
            "HowTo",
        ]) {
            node(type);
        }
    });

    it("only points at nodes that exist", () => {
        const ids = new Set(graph.map((entry) => entry["@id"]));
        assert.equal(ids.size, graph.length, "every node has its own @id");
        const references = [...JSON.stringify(graph).matchAll(/\{"@id":"([^"]+)"\}/g)];
        assert.ok(references.length > 0);
        for (const [, id] of references) assert.ok(ids.has(id), `${id} is not in the graph`);
    });

    it("says exactly what the page says", () => {
        const faq = node("FAQPage").mainEntity as {
            name: string;
            acceptedAnswer: { text: string };
        }[];
        assert.deepEqual(
            faq.map((entry) => [entry.name, entry.acceptedAnswer.text]),
            questions.map((entry) => [entry.question, entry.answer]),
        );
        const howTo = node("HowTo").step as { text: string }[];
        assert.deepEqual(
            howTo.map((step) => step.text),
            steps.map((step) => step.text),
        );
        assert.deepEqual(node("WebApplication").featureList, features);
    });

    it("is free, and says so the way search engines expect", () => {
        const offers = node("WebApplication").offers as { price: string };
        assert.equal(offers.price, "0");
    });

    it("cannot close the script element it is embedded in", () => {
        const json = structuredDataJson();
        assert.ok(!json.includes("<"));
        assert.deepEqual(JSON.parse(json), structuredData());
    });
});

describe("files for machines", () => {
    it("are up to date in public/ (run `pnpm seo`)", async () => {
        for (const [name, content] of Object.entries(files)) {
            assert.equal(await published(name), content(), `public/${name} is out of date`);
        }
    });

    it("follow the llms.txt format: a title, a summary, then sections of links", () => {
        const text = files["llms.txt"]();
        const lines = text.split("\n");
        assert.equal(lines[0], `# ${site.name}`);
        assert.equal(lines[2], `> ${site.summary}`);
        assert.equal(text.match(/^# /gm)?.length, 1);
        const links = lines.filter((line) => line.startsWith("- ["));
        assert.ok(links.length >= 4);
        for (const link of links) assert.match(link, /^- \[[^\]]+\]\(https:\/\/[^)\s]+\): \S/);
    });

    it("carry every question and every feature in llms-full.txt", () => {
        const text = files["llms-full.txt"]();
        for (const entry of questions) {
            assert.ok(text.includes(`### ${entry.question}\n\n${entry.answer}`), entry.question);
        }
        for (const feature of features) assert.ok(text.includes(`- ${feature}`), feature);
    });

    it("list only the start page in the sitemap", () => {
        const locations = [...files["sitemap.xml"]().matchAll(/<loc>([^<]+)<\/loc>/g)];
        assert.deepEqual(
            locations.map(([, url]) => url),
            [site.url],
        );
    });
});

describe("robots.txt", () => {
    // The longest matching rule wins, as in RFC 9309. `$` anchors the end, `*` is not used here.
    const allowed = (robots: string, path: string) => {
        let winner = { length: -1, allow: true };
        for (const [, kind, rule] of robots.matchAll(/^(Allow|Disallow): (\S+)$/gm)) {
            const matches = rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule);
            if (matches && rule.length > winner.length) {
                winner = { length: rule.length, allow: kind === "Allow" };
            }
        }
        return winner.allow;
    };

    it("opens the start page, what it is made of, and the files for machines", async () => {
        const robots = await published("robots.txt");
        for (const path of [
            "/",
            "/llms.txt",
            "/llms-full.txt",
            "/sitemap.xml",
            "/og.png",
            "/_build/assets/entry-client-BxR6tHu7.js",
            "/fonts/fontshare/clash-display-600.woff2",
            "/v3",
        ]) {
            assert.equal(allowed(robots, path), true, path);
        }
    });

    it("keeps everything else closed, chat pages above all", async () => {
        const robots = await published("robots.txt");
        for (const path of [
            "/chat/forsen",
            "/v3/chat/forsen",
            "/api/irc",
            "/privacy",
            "/imprint",
            "/setup",
        ]) {
            assert.equal(allowed(robots, path), false, path);
        }
    });

    it("names the sitemap and one set of rules for every crawler", async () => {
        const robots = await published("robots.txt");
        assert.ok(robots.includes(`Sitemap: ${site.origin}/sitemap.xml`));
        assert.deepEqual(robots.match(/^User-agent: .+$/gm), ["User-agent: *"]);
    });
});
