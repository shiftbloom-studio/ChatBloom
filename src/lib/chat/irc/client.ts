import { ReconnectingSocket } from "../socket";
import { ChatTransport, RELAY_JOIN_TIMEOUT_MS } from "../transport";
import { type IrcMessage, parseIrcLine } from "./parse";

const PING_INTERVAL_MS = 60_000;

/**
 * The relay answers exactly this text without waking up, so it must not change on its own:
 * `CLIENT_PING` in `src/worker/relay/core.ts` is the other half.
 */
const KEEP_ALIVE = "PING :petal";

/**
 * Twitch answers a JOIN within a second. One it has not answered after this long it dropped
 * without a word, which is what it does with a channel that does not exist; the relay gives
 * Twitch as long.
 */
const TWITCH_ANSWER_TIMEOUT_MS = 10_000;

/**
 * When a refused channel is asked for again, doubling up to the longest wait. A suspension
 * lasts days rather than seconds, so the channel is checked on rarely, as the relay does.
 */
const RECHECK_MS = 10_000;
const MAX_RECHECK_MS = 300_000;

/**
 * `unavailable`: Twitch refused the channel as suspended or deleted, or never answered its
 * JOIN. It lasts through reconnects, which tell nothing new, until Twitch confirms a JOIN.
 */
export type IrcStatus = "connecting" | "connected" | "unavailable";

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
    #channel: string;
    #socket: ReconnectingSocket;
    #transport: ChatTransport;
    #onStatus: ((status: IrcStatus) => void) | undefined;
    #pingTimer: ReturnType<typeof setInterval> | undefined;
    #joinTimer: ReturnType<typeof setTimeout> | undefined;
    #recheckTimer: ReturnType<typeof setTimeout> | undefined;
    #recheckMs = RECHECK_MS;
    /** The JOIN echo arrived over the current connection. */
    #live = false;
    #unavailable = false;

    constructor(options: TwitchIrcOptions) {
        const channel = options.channel.toLowerCase();
        this.#channel = channel;
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
                        case "001":
                            // Twitch took the login, so the JOIN sent after it is next. The relay
                            // welcomes at once and asks Twitch only then: it has its own deadline.
                            if (this.#transport.route === "direct") this.#awaitAnswer();
                            options.onMessage(message);
                            break;
                        case "JOIN":
                            clearTimeout(this.#joinTimer);
                            this.#stopRechecking();
                            this.#recheckMs = RECHECK_MS;
                            this.#live = true;
                            this.#unavailable = false;
                            this.#transport.answered();
                            socket.settle();
                            this.#onStatus?.("connected");
                            break;
                        case "NOTICE":
                            // Twitch's answer to the JOIN of a suspended or deleted channel, over
                            // the relay as well. Said on a live connection it is left to the chat.
                            if (!this.#live && this.#isRefusal(message)) {
                                this.#transport.answered();
                                socket.settle();
                                this.#refused();
                            } else {
                                options.onMessage(message);
                            }
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
        this.#stopRechecking();
        this.#socket.stop();
    }

    #lost(): "now" | "backoff" {
        clearTimeout(this.#joinTimer);
        // The next connection asks with its own JOIN.
        this.#stopRechecking();
        this.#live = false;
        if (!this.#unavailable) this.#onStatus?.("connecting");
        return this.#transport.lost();
    }

    #isRefusal(message: IrcMessage): boolean {
        return (
            message.tags["msg-id"] === "msg_channel_suspended" &&
            message.params[0] === `#${this.#channel}`
        );
    }

    /**
     * Twitch will not have the channel, or not yet. The connection stays open all the same:
     * the relay asks Twitch again by itself and greets the overlay once the channel is back.
     * Twitch does not, so over a direct connection the overlay asks again, ever more rarely.
     */
    #refused(): void {
        clearTimeout(this.#joinTimer);
        if (!this.#unavailable) {
            this.#unavailable = true;
            this.#onStatus?.("unavailable");
        }
        if (this.#transport.route !== "direct") return;
        this.#stopRechecking();
        const delay = this.#recheckMs;
        this.#recheckMs = Math.min(MAX_RECHECK_MS, delay * 2);
        this.#recheckTimer = setTimeout(() => {
            this.#recheckTimer = undefined;
            this.#socket.send(`JOIN #${this.#channel}`);
            this.#awaitAnswer();
        }, delay);
    }

    #stopRechecking(): void {
        clearTimeout(this.#recheckTimer);
        this.#recheckTimer = undefined;
    }

    /**
     * Gives a relay attempt its deadline. Twitch itself is the last resort and gets none: there
     * is nothing left to fall back to, and the idle timeout covers a connection that went dead.
     * Its silence after the login says something about the channel instead (`#awaitAnswer`).
     */
    #expectJoin(): void {
        clearTimeout(this.#joinTimer);
        if (this.#transport.route !== "relay") return;
        this.#joinTimer = setTimeout(() => {
            console.warn(`[twitch-irc] no JOIN from the relay for ${RELAY_JOIN_TIMEOUT_MS}ms`);
            this.#socket.reconnect(this.#lost() === "now");
        }, RELAY_JOIN_TIMEOUT_MS);
    }

    /** Over a direct connection, a JOIN that Twitch leaves unanswered names no channel. */
    #awaitAnswer(): void {
        clearTimeout(this.#joinTimer);
        this.#joinTimer = setTimeout(() => {
            console.warn(`[twitch-irc] no answer from Twitch to JOIN #${this.#channel}`);
            this.#refused();
        }, TWITCH_ANSWER_TIMEOUT_MS);
    }
}
