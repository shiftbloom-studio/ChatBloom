// Whether a request comes from a program that says it is one. Cloudflare's own bot signals
// (`request.cf.botManagement`) need Enterprise Bot Management, so the only evidence a Worker has
// is the request itself. Neither dependency nor runtime API is used, so the Nitro middleware and
// the relay's Worker entry can both import this file.
//
// This stops crawlers, AI scrapers and scripts that do not disguise themselves. A program that
// sends a browser's `User-Agent` passes; the zone's rate limit and WAF rule are for that
// (docs/DEPLOYMENT.md). Nothing here may be a challenge: OBS cannot answer a challenge page,
// and a false positive would blank a streamer's overlay mid-stream.
const AUTOMATION = new RegExp(
    [
        // Crawlers name themselves: Googlebot, GPTBot, ClaudeBot, Bytespider, UptimeRobot. Not
        // `Cubot`, a phone brand whose user agent can end in the same letters.
        String.raw`(?<!cu)bot\b|robot|crawl|spider|slurp`,
        // Crawlers and link unfurlers that leave "bot" out of their name.
        "chatgpt-user|claude-user|anthropic|cohere|perplexity|meta-external|facebookexternalhit",
        String.raw`\bgoogle-|googleother|adsbot|mediapartners|feedfetcher|bingpreview`,
        // Libraries and command line tools. Browsers and streaming software (OBS, Streamlabs,
        // Meld and others embed Chromium) send none of these.
        "curl|wget|python|aiohttp|httpx|go-http-client|libwww|lwp-|scrapy|colly|mechanize|jsdom",
        String.raw`\bjava/|apache-httpclient|node-fetch|undici|axios|\bgot \(|superagent|\bdeno/|\bbun/`,
        "postman|insomnia|httpie|guzzle|phantomjs|^ruby|^php",
        "nuclei|sqlmap|nikto|masscan|zgrab|wpscan|gobuster|ffuf",
    ].join("|"),
    "i",
);

/**
 * A browser always sends a `User-Agent`, so a request without one is a script. That is the
 * default of Node's `ws` and of most command line WebSocket clients.
 */
export function isAutomated(userAgent: string | null | undefined): boolean {
    const agent = userAgent?.trim();
    return !agent || AUTOMATION.test(agent);
}

/**
 * The pages that show chat. The router matches paths case-insensitively and decodes them, so
 * `/CHAT/x` and `/%63hat/x` reach the overlay and must be caught as well.
 */
export function isChatPage(pathname: string): boolean {
    let path = pathname;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        // Not valid percent-encoding; the raw path is all there is to look at.
    }
    return /^\/chat(?:\/|$)/i.test(path);
}
