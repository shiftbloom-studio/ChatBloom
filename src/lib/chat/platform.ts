/**
 * The origin whose Worker relays chat and caches provider data, or undefined when the overlay
 * has to reach Twitch and the providers itself: outside a browser, on a page that was not
 * loaded over http(s), such as a local file in OBS, and when `?direct=1` asks for it.
 */
export function platformOrigin(): string | undefined {
    if (typeof location === "undefined") return undefined;
    if (location.protocol !== "https:" && location.protocol !== "http:") return undefined;
    if (new URLSearchParams(location.search).get("direct") === "1") return undefined;
    return location.origin;
}
