import { ReconnectingSocket } from "../socket";
import { ChatTransport, RELAY_JOIN_TIMEOUT_MS } from "../transport";
import { type IrcMessage, parseIrcLine } from "./parse";

const PING_INTERVAL_MS = 60_000;

/**
 * The relay answers exactly this text without waking up, so it must not change on its own:
 * `CLIENT_PING` in `src/worker/relay/core.ts` is the other half.
 */
const KEEP_ALIVE = "PING :petal";

export type IrcStatus = "connecting" | "connected";

export interface TwitchIrcOptions {
    channel: string;
    onMessage: (message: IrcMessage) => void;
    onStatus?: (status: IrcStatus) => void;
}

/**
 * Read-only, anonymous (`justinfan`) Twitch chat connection for a single channel. The relay
 * speaks the same protocol as Twitch, so only the URL differs between the two.
 */
export class TwitchIrc {
    #socket: ReconnectingSocket;
    #transport: ChatTransport;
    #onStatus: ((status: IrcStatus) => void) | undefined;
    #pingTimer: ReturnType<typeof setInterval> | undefined;
    #joinTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: TwitchIrcOptions) {
        const channel = options.channel.toLowerCase();
        this.#transport = new ChatTransport(channel);
        this.#onStatus = options.onStatus;
        this.#socket = new ReconnectingSocket({
            label: "twitch-irc",
            url: () => {
                // Evaluated as an attempt starts. The deadline runs from here and not only
                // from the open socket, because a relay that is unreachable may never open one.
                this.#expectJoin();
                return this.#transport.url;
            },
            // Our own PINGs get a PONG well within this window on a healthy connection.
            idleTimeoutMs: PING_INTERVAL_MS * 1.5,
            // The relay accepts the socket before it has joined the channel at Twitch.
            settleManually: true,
            onLost: () => this.#lost(),
            onOpen: (socket) => {
                this.#expectJoin();
                socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
                socket.send(`NICK justinfan${10_000 + Math.floor(Math.random() * 89_999)}`);
                socket.send(`JOIN #${channel}`);
            },
            onMessage: (data, socket) => {
                for (const line of data.split("\r\n")) {
                    if (!line) continue;
                    const message = parseIrcLine(line);
                    if (!message) continue;
                    switch (message.command) {
                        case "PING":
                            socket.send(`PONG :${message.params[0] ?? "tmi.twitch.tv"}`);
                            break;
                        case "RECONNECT":
                            // Twitch is about to close this connection and says so in advance.
                            this.#lost();
                            socket.reconnect(true);
                            break;
                        case "JOIN":
                            clearTimeout(this.#joinTimer);
                            this.#transport.joined();
                            socket.settle();
                            this.#onStatus?.("connected");
                            break;
                        default:
                            options.onMessage(message);
                    }
                }
            },
        });
        this.#socket.start();
        this.#pingTimer = setInterval(() => this.#socket.send(KEEP_ALIVE), PING_INTERVAL_MS);
    }

    close(): void {
        clearInterval(this.#pingTimer);
        clearTimeout(this.#joinTimer);
        this.#socket.stop();
    }

    #lost(): "now" | "backoff" {
        clearTimeout(this.#joinTimer);
        this.#onStatus?.("connecting");
        return this.#transport.lost();
    }

    /**
     * Gives a relay attempt its deadline. Twitch itself is the last resort and gets none: there
     * is nothing left to fall back to, and the idle timeout covers a connection that went dead.
     */
    #expectJoin(): void {
        clearTimeout(this.#joinTimer);
        if (this.#transport.route !== "relay") return;
        this.#joinTimer = setTimeout(() => {
            console.warn(`[twitch-irc] no JOIN from the relay for ${RELAY_JOIN_TIMEOUT_MS}ms`);
            this.#socket.reconnect(this.#lost() === "now");
        }, RELAY_JOIN_TIMEOUT_MS);
    }
}
