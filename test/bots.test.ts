import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAutomated, isChatPage } from "../src/server/bots";

describe("isAutomated", () => {
    it("lets browsers through, including the ones inside streaming software", () => {
        for (const agent of [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.120 Safari/537.36 OBS/31.0.3",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Linux; Android 14; CUBOT P80) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
        ]) {
            assert.equal(isAutomated(agent), false, agent);
        }
    });

    it("refuses a request without a user agent", () => {
        assert.equal(isAutomated(null), true);
        assert.equal(isAutomated(undefined), true);
        assert.equal(isAutomated(""), true);
        assert.equal(isAutomated("   "), true);
    });

    it("refuses crawlers, search engines and AI scrapers", () => {
        for (const agent of [
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
            "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
            "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
            "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
            "CCBot/2.0 (https://commoncrawl.org/faq/)",
            "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
            "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
            "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
            "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
            "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
            "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
        ]) {
            assert.equal(isAutomated(agent), true, agent);
        }
    });

    it("refuses libraries and command line tools", () => {
        for (const agent of [
            "curl/8.7.1",
            "Wget/1.21.4",
            "python-requests/2.32.3",
            "Python/3.12 websockets/13.1",
            "Python-urllib/3.12",
            "aiohttp/3.10.5",
            "python-httpx/0.27.2",
            "Go-http-client/2.0",
            "Java/21.0.4",
            "Apache-HttpClient/4.5.14 (Java/17.0.1)",
            "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
            "axios/1.7.7",
            "got (https://github.com/sindresorhus/got)",
            "undici",
            "Deno/2.0.0",
            "Bun/1.1.30",
            "PostmanRuntime/7.42.0",
            "Scrapy/2.11.2 (+https://scrapy.org)",
            "Ruby",
            "PHP/8.3",
        ]) {
            assert.equal(isAutomated(agent), true, agent);
        }
    });

    it("cannot tell a script that sends a browser's user agent", () => {
        // Documented limit: the zone's rate limit and WAF rule cover this, not this check.
        assert.equal(
            isAutomated(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            ),
            false,
        );
    });
});

describe("isChatPage", () => {
    it("matches the overlay under both of its addresses", () => {
        assert.equal(isChatPage("/chat/forsen"), true);
        assert.equal(isChatPage("/chat/forsen/"), true);
        assert.equal(isChatPage("/v3/chat/forsen"), true);
        assert.equal(isChatPage("/chat"), true);
    });

    it("cannot be sidestepped by case or percent-encoding", () => {
        assert.equal(isChatPage("/V3/CHAT/forsen"), true);
        assert.equal(isChatPage("/Chat/forsen"), true);
        assert.equal(isChatPage("/v3/%63hat/forsen"), true);
        assert.equal(isChatPage("/%76%33/chat/forsen"), true);
    });

    it("leaves the start page, the setup page and the rest alone", () => {
        assert.equal(isChatPage("/"), false);
        assert.equal(isChatPage("/v3"), false);
        assert.equal(isChatPage("/setup"), false);
        assert.equal(isChatPage("/privacy"), false);
        assert.equal(isChatPage("/chatter"), false);
        assert.equal(isChatPage("/v3/chatter/forsen"), false);
        assert.equal(isChatPage("/fonts/chat/x.woff2"), false);
    });

    it("copes with invalid percent-encoding", () => {
        assert.equal(isChatPage("/chat/%E0%A4%A"), true);
        assert.equal(isChatPage("/%E0%A4%A"), false);
    });
});
