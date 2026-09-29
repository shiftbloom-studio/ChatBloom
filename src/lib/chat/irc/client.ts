import { ReconnectingSocket } from "../socket";
import { type IrcMessage, parseIrcLine } from "./parse";

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const PING_INTERVAL_MS = 60_000;

export type IrcStatus = "connecting" | "connected";

export interface TwitchIrcOptions {
    channel: string;
    onMessage: (message: IrcMessage) => void;
    onStatus?: (status: IrcStatus) => void;
}

/** Read-only, anonymous (`justinfan`) Twitch chat connection for a single channel. */
export class TwitchIrc {
    #socket: ReconnectingSocket;
    #pingTimer: ReturnType<typeof setInterval> | undefined;

    constructor(options: TwitchIrcOptions) {
        const channel = options.channel.toLowerCase();
        this.#socket = new ReconnectingSocket({
            label: "twitch-irc",
            url: () => IRC_URL,
            // Our own PINGs get a PONG well within this window on a healthy connection.
            idleTimeoutMs: PING_INTERVAL_MS * 1.5,
            onClose: () => options.onStatus?.("connecting"),
            onOpen: (socket) => {
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
                            socket.reconnect(true);
                            break;
                        case "JOIN":
                            options.onStatus?.("connected");
                            break;
                        default:
                            options.onMessage(message);
                    }
                }
            },
        });
        this.#socket.start();
        this.#pingTimer = setInterval(() => this.#socket.send("PING :chatbloom"), PING_INTERVAL_MS);
    }

    close(): void {
        clearInterval(this.#pingTimer);
        this.#socket.stop();
    }
}
