import { platformOrigin } from "./platform";

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

/** A relay attempt that has not seen its JOIN echo after this long has failed. */
export const RELAY_JOIN_TIMEOUT_MS = 15_000;

/** Failed relay attempts in a row after which the overlay connects to Twitch itself. */
const RELAY_ATTEMPTS = 2;

export type ChatRoute = "relay" | "direct";

function relayUrl(channel: string): string | undefined {
    const origin = platformOrigin();
    if (!origin) return undefined;
    return `${origin.replace(/^http/, "ws")}/api/irc?channel=${encodeURIComponent(channel)}`;
}

/**
 * Decides where the chat connection goes. The relay on the overlay's own origin comes first,
 * and every time a working connection is lost it comes first again; Twitch itself is the
 * fallback, so that a relay outage costs an overlay seconds of chat and not the stream.
 */
export class ChatTransport {
    #relay: string | undefined;
    #route: ChatRoute;
    #failedAttempts = 0;
    #joined = false;

    constructor(channel: string) {
        this.#relay = relayUrl(channel);
        this.#route = this.#relay ? "relay" : "direct";
    }

    /** Where the current attempt goes, or the next one while there is none. */
    get route(): ChatRoute {
        return this.#route;
    }

    get url(): string {
        return this.#route === "relay" && this.#relay ? this.#relay : TWITCH_IRC_URL;
    }

    /** The JOIN echo arrived: chat flows over the current connection. */
    joined(): void {
        this.#joined = true;
        this.#failedAttempts = 0;
    }

    /**
     * The current connection closed, went silent or missed its deadline. Tells how soon the
     * next attempt follows and moves on to the route it takes.
     */
    lost(): "now" | "backoff" {
        const failedRelayAttempt = this.#route === "relay" && !this.#joined;
        this.#joined = false;
        if (failedRelayAttempt) {
            this.#failedAttempts++;
            if (this.#failedAttempts >= RELAY_ATTEMPTS) this.#route = "direct";
            return "now";
        }
        this.#failedAttempts = 0;
        if (this.#relay) this.#route = "relay";
        return "backoff";
    }
}
