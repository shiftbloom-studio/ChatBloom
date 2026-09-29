import { platformOrigin } from "./platform";

/**
 * Provider base URLs and where the data gateway of the overlay's own origin serves them. The
 * rest of the path and the query stay as the provider expects them. Mirrors
 * `GATEWAY_PREFIXES` in `src/worker/gateway/routes.ts`, which the browser bundle cannot import.
 */
export const GATEWAY_PREFIXES: Readonly<Record<string, string>> = {
    "https://7tv.io/": "/api/data/7tv/",
    "https://api.betterttv.net/": "/api/data/bttv/",
    "https://api.frankerfacez.com/": "/api/data/ffz/",
    "https://api.ffzap.com/": "/api/data/ffzap/",
    "https://api.chatterino.com/": "/api/data/chatterino/",
    "https://api.ivr.fi/": "/api/data/ivr/",
};

/** The gateway itself gives a provider six seconds; longer than that and it is stuck. */
const GATEWAY_TIMEOUT_MS = 8000;

/** On every answer of the gateway, and on nothing else that may answer under its path. */
const GATEWAY_HEADER = "x-petal-cache";

/** What a provider request consists of; both the gateway and the provider get all of it. */
export type JsonRequest = Pick<RequestInit, "method" | "headers" | "body">;

/** The gateway URL for a provider URL; undefined when the provider has to be asked itself. */
export function gatewayUrl(url: string): string | undefined {
    const origin = platformOrigin();
    if (!origin) return undefined;
    for (const [base, prefix] of Object.entries(GATEWAY_PREFIXES)) {
        if (url.startsWith(base)) return origin + prefix + url.slice(base.length);
    }
    return undefined;
}

async function readJson<T>(response: Response, url: string): Promise<T | undefined> {
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return (await response.json()) as T;
}

async function fetchFromGateway<T>(url: string, request?: JsonRequest): Promise<T | undefined> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), GATEWAY_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...request, signal: deadline.signal });
        // A 404 from the gateway is the provider's answer. A 404 from whatever else serves
        // this origin, such as a deployment without the gateway, says nothing about the data.
        const answer = response.ok || response.status === 404;
        if (answer && !response.headers.has(GATEWAY_HEADER)) {
            throw new Error(`${url} is not the gateway`);
        }
        // Awaited here, so the deadline covers the body as well.
        return await readJson<T>(response, url);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetches provider data as JSON, undefined when the provider answers 404. The gateway is asked
 * first; whenever it fails to give the provider's answer, the provider is asked directly, which
 * is all the overlay did before there was a gateway.
 */
export async function fetchJson<T>(url: string, request?: JsonRequest): Promise<T | undefined> {
    const gateway = gatewayUrl(url);
    if (gateway) {
        try {
            return await fetchFromGateway<T>(gateway, request);
        } catch (error) {
            console.warn("[gateway] no answer, asking the provider directly", error);
        }
    }
    return readJson<T>(await fetch(url, request), url);
}
