// A stand-in for the Twitch IRC WebSocket endpoint, for tests of the chat relay that need
// failures on demand. It listens on 127.0.0.1 only, never talks to Twitch, and every chat line
// it emits is synthetic.
//
// Usage: node scripts/e2e/mock-twitch.mjs [port]
// The relay connects to ws://127.0.0.1:<port>. The same port answers the control interface:
//
//   GET  /ctl/state                          what the mock received, and its open connections
//   POST /ctl/say?channel=&n=&user=&command= emits n chat lines, answers with their ids
//   POST /ctl/raw?channel=                   sends the request body as one frame
//   POST /ctl/reconnect                      sends RECONNECT
//   POST /ctl/drop                           tears connections down without a close frame
//   POST /ctl/close?code=                    closes connections with a close frame
//   POST /ctl/mode?silent=&refuse=&partDelayMs=   switches are 1 or 0
//
// say and raw reach the connections that joined `channel`. reconnect, drop and close take
// `channel` or `connection` (an id) to narrow their targets, and hit every connection without.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** Fixed by RFC 6455: proves that the server understood the handshake as a WebSocket one. */
const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

/** IRC lines are at most a few kilobytes; anything near this size is a broken peer. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
const CLOSE_HANDSHAKE_MS = 2000;

/** What Twitch documents for JOINs of one connection that is not a verified bot. */
const JOIN_LIMIT = 20;
const JOIN_WINDOW_MS = 10_000;

/** Twitch never answers the JOIN of a channel that does not exist; these names play that part. */
const NONEXISTENT_PREFIX = "nx";

/** The control interface, with the method each part of it takes. */
const CONTROLS = new Map([
    ["/ctl/state", "GET"],
    ["/ctl/say", "POST"],
    ["/ctl/raw", "POST"],
    ["/ctl/reconnect", "POST"],
    ["/ctl/drop", "POST"],
    ["/ctl/close", "POST"],
    ["/ctl/mode", "POST"],
]);

function encodeFrame(opcode, payload) {
    const length = payload.length;
    let header;
    if (length < 126) {
        header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65_536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, payload]);
}

/**
 * The server side of one WebSocket connection. Node has a WebSocket client but no server, and
 * the project takes no dependency for a test tool, so the framing of RFC 6455 is done here:
 * text frames, fragments, ping, pong and close, without extensions.
 */
class Peer {
    #socket;
    #pending = Buffer.alloc(0);
    #fragments = [];
    #fragmentBytes = 0;
    #fragmentOpcode = 0;
    #closeSent = false;
    #closeTimer;
    /** The code the other side closed with; 1006 when the connection ended without one. */
    closeCode = 1006;
    onText = () => {};
    onClose = () => {};

    constructor(socket, head) {
        this.#socket = socket;
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this.#receive(chunk));
        socket.on("close", () => {
            clearTimeout(this.#closeTimer);
            this.onClose(this.closeCode);
        });
        // A reset connection is reported by `close` as well; there is nothing else to do.
        socket.on("error", () => {});
        if (head.length > 0) this.#receive(head);
    }

    sendText(text) {
        this.#write(OPCODE_TEXT, Buffer.from(text, "utf8"));
    }

    close(code) {
        if (this.#closeSent) return;
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(code);
        this.#write(OPCODE_CLOSE, payload);
        this.#closing();
    }

    /** Ends the connection the way a crashed server or a broken network does. */
    terminate() {
        this.#socket.destroy();
    }

    /** After the close frame nothing else may be sent; a peer that never hangs up is cut off. */
    #closing() {
        this.#closeSent = true;
        this.#closeTimer = setTimeout(() => this.#socket.destroy(), CLOSE_HANDSHAKE_MS);
    }

    #write(opcode, payload) {
        if (this.#closeSent || this.#socket.destroyed || !this.#socket.writable) return;
        this.#socket.write(encodeFrame(opcode, payload));
    }

    #receive(chunk) {
        this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
        for (;;) {
            const buffer = this.#pending;
            if (buffer.length < 2) return;
            const final = (buffer[0] & 0x80) !== 0;
            const opcode = buffer[0] & 0x0f;
            const masked = (buffer[1] & 0x80) !== 0;
            let length = buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < 4) return;
                length = buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (buffer.length < 10) return;
                const announced = buffer.readBigUInt64BE(2);
                if (announced > BigInt(MAX_MESSAGE_BYTES)) return this.#fail(1009);
                length = Number(announced);
                offset = 10;
            }
            // Clients must mask, and no extension that would use the reserved bits was agreed.
            if (!masked || (buffer[0] & 0x70) !== 0) return this.#fail(1002);
            if (length > MAX_MESSAGE_BYTES) return this.#fail(1009);
            const end = offset + 4 + length;
            if (buffer.length < end) return;
            const mask = buffer.subarray(offset, offset + 4);
            const payload = Buffer.from(buffer.subarray(offset + 4, end));
            for (let index = 0; index < length; index++) payload[index] ^= mask[index & 3];
            this.#pending = buffer.subarray(end);
            this.#frame(final, opcode, payload);
            if (this.#closeSent) return;
        }
    }

    #frame(final, opcode, payload) {
        switch (opcode) {
            case OPCODE_CLOSE:
                if (payload.length >= 2) this.closeCode = payload.readUInt16BE(0);
                else this.closeCode = 1005;
                if (!this.#closeSent) {
                    this.#write(OPCODE_CLOSE, payload.subarray(0, 2));
                    this.#closing();
                }
                this.#socket.end();
                return;
            case OPCODE_PING:
                this.#write(OPCODE_PONG, payload);
                return;
            case OPCODE_PONG:
                return;
            case OPCODE_TEXT:
            case OPCODE_BINARY:
                if (this.#fragments.length > 0) return this.#fail(1002);
                if (final) return this.#message(opcode, payload);
                this.#fragmentOpcode = opcode;
                this.#fragments = [payload];
                this.#fragmentBytes = payload.length;
                return;
            case OPCODE_CONTINUATION: {
                if (this.#fragments.length === 0) return this.#fail(1002);
                this.#fragments.push(payload);
                this.#fragmentBytes += payload.length;
                if (this.#fragmentBytes > MAX_MESSAGE_BYTES) return this.#fail(1009);
                if (!final) return;
                const whole = Buffer.concat(this.#fragments);
                this.#fragments = [];
                this.#fragmentBytes = 0;
                return this.#message(this.#fragmentOpcode, whole);
            }
            default:
                return this.#fail(1002);
        }
    }

    #message(opcode, payload) {
        // Twitch IRC is text only, and so is everything the relay sends.
        if (opcode === OPCODE_TEXT) this.onText(payload.toString("utf8"));
    }

    #fail(code) {
        this.close(code);
        this.#socket.end();
    }
}

function refuseUpgrade(socket, status, reason) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        request.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_MESSAGE_BYTES) {
                reject(new Error("request body too large"));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}

/**
 * Starts the mock. `port` 0 takes any free port; the chosen one is part of the result.
 * Resolves to `{ port, url, controlUrl, close }`.
 */
export async function startMockTwitch({ port = 0 } = {}) {
    const mode = {
        /** Accepts and reads, but sends nothing: a connection that died without closing. */
        silent: false,
        /** Refuses new connections with 503. */
        refuse: false,
        /** Delays the PART confirmation, so a channel stays joined on two connections. */
        partDelayMs: 0,
    };
    const counts = { opened: 0, refused: 0, logins: 0, joins: 0, droppedJoins: 0, parts: 0 };
    const connections = new Map();
    const closed = [];
    const events = [];
    const timers = new Set();
    let nextConnection = 1;
    let nextLine = 1;

    const record = (connection, type, channel) => {
        events.push({ at: Date.now(), connection: connection.id, type, channel });
    };

    const later = (ms, work) => {
        if (ms <= 0) return work();
        const timer = setTimeout(() => {
            timers.delete(timer);
            work();
        }, ms);
        timers.add(timer);
    };

    const send = (connection, lines) => {
        if (!mode.silent) connection.peer.sendText(`${lines.join("\r\n")}\r\n`);
    };

    const describe = (connection) => ({
        id: connection.id,
        nick: connection.nick,
        capabilities: connection.capabilities,
        channels: [...connection.channels],
        joins: connection.joinTimes.length,
        maxJoinsPerWindow: connection.maxJoinsPerWindow,
        droppedJoins: connection.droppedJoins,
        parts: connection.parts,
        pings: connection.pings,
        pongs: connection.pongs,
        openedAt: connection.openedAt,
    });

    function join(connection, channel) {
        const now = Date.now();
        connection.joinTimes.push(now);
        const inWindow = connection.joinTimes.filter((at) => at > now - JOIN_WINDOW_MS).length;
        connection.maxJoinsPerWindow = Math.max(connection.maxJoinsPerWindow, inWindow);
        if (inWindow > JOIN_LIMIT) {
            // Twitch drops a JOIN above the limit without telling the client.
            connection.droppedJoins++;
            counts.droppedJoins++;
            record(connection, "join-dropped", channel);
            return;
        }
        counts.joins++;
        record(connection, "join", channel);
        if (channel.startsWith(NONEXISTENT_PREFIX)) return;
        connection.channels.add(channel);
        const { nick } = connection;
        send(connection, [
            `:${nick}!${nick}@${nick}.tmi.twitch.tv JOIN #${channel}`,
            `:${nick}.tmi.twitch.tv 353 ${nick} = #${channel} :${nick}`,
            `:${nick}.tmi.twitch.tv 366 ${nick} #${channel} :End of /NAMES list`,
            `@emote-only=0;followers-only=-1;r9k=0;room-id=1;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #${channel}`,
        ]);
    }

    function part(connection, channel) {
        connection.parts++;
        counts.parts++;
        record(connection, "part", channel);
        later(mode.partDelayMs, () => {
            if (!connection.channels.delete(channel)) return;
            const { nick } = connection;
            send(connection, [`:${nick}!${nick}@${nick}.tmi.twitch.tv PART #${channel}`]);
        });
    }

    function command(connection, line) {
        const space = line.indexOf(" ");
        const name = space === -1 ? line : line.slice(0, space);
        const rest = space === -1 ? "" : line.slice(space + 1);
        switch (name) {
            case "CAP":
                connection.capabilities = rest.replace(/^REQ :?/, "");
                send(connection, [`:tmi.twitch.tv CAP * ACK ${rest.replace(/^REQ /, "")}`]);
                return;
            case "NICK":
                connection.nick = rest;
                counts.logins++;
                record(connection, "login");
                send(connection, [
                    `:tmi.twitch.tv 001 ${rest} :Welcome, GLHF!`,
                    `:tmi.twitch.tv 002 ${rest} :Your host is tmi.twitch.tv`,
                    `:tmi.twitch.tv 003 ${rest} :This server is rather new`,
                    `:tmi.twitch.tv 004 ${rest} :-`,
                    `:tmi.twitch.tv 375 ${rest} :-`,
                    `:tmi.twitch.tv 372 ${rest} :You are in a maze of twisty passages, all alike.`,
                    `:tmi.twitch.tv 376 ${rest} :>`,
                ]);
                return;
            case "JOIN":
                for (const target of rest.split(",")) join(connection, target.replace(/^#/, ""));
                return;
            case "PART":
                for (const target of rest.split(",")) part(connection, target.replace(/^#/, ""));
                return;
            case "PING":
                connection.pings++;
                send(connection, [`:tmi.twitch.tv PONG tmi.twitch.tv ${rest}`]);
                return;
            case "PONG":
                connection.pongs++;
                return;
        }
    }

    function accept(socket, head) {
        const connection = {
            id: nextConnection++,
            peer: new Peer(socket, head),
            nick: undefined,
            capabilities: undefined,
            channels: new Set(),
            joinTimes: [],
            maxJoinsPerWindow: 0,
            droppedJoins: 0,
            parts: 0,
            pings: 0,
            pongs: 0,
            openedAt: Date.now(),
        };
        connections.set(connection.id, connection);
        counts.opened++;
        record(connection, "open");
        connection.peer.onText = (frame) => {
            for (const line of frame.split(/\r?\n/)) if (line) command(connection, line);
        };
        connection.peer.onClose = (closeCode) => {
            connections.delete(connection.id);
            record(connection, "close");
            closed.push({ ...describe(connection), closeCode, closedAt: Date.now() });
        };
    }

    function targets(query) {
        const id = query.get("connection");
        const channel = query.get("channel");
        return [...connections.values()].filter(
            (connection) =>
                (id === null || String(connection.id) === id) &&
                (channel === null || connection.channels.has(channel)),
        );
    }

    function say(query) {
        const channel = query.get("channel");
        if (!channel) return { status: 400, body: { error: "channel is required" } };
        const count = Number(query.get("n") ?? 1);
        const user = query.get("user") ?? "1001";
        const verb = query.get("command") ?? "PRIVMSG";
        const ids = [];
        for (let index = 0; index < count; index++) {
            // Shaped like the ids Twitch assigns, and ascending, so order can be checked.
            const id = `00000000-0000-4000-8000-${String(nextLine++).padStart(12, "0")}`;
            ids.push(id);
            const line =
                `@badge-info=;badges=;color=#1E90FF;display-name=Mock${user};emotes=;id=${id};` +
                `room-id=1;tmi-sent-ts=${Date.now()};user-id=${user};user-type= ` +
                `:mock${user}!mock${user}@mock${user}.tmi.twitch.tv ${verb} #${channel} ` +
                `:synthetic line ${nextLine - 1}`;
            for (const connection of targets(query)) send(connection, [line]);
        }
        return { status: 200, body: { ids } };
    }

    async function control(request, url) {
        const query = url.searchParams;
        const method = CONTROLS.get(url.pathname);
        if (!method) return { status: 404, body: { error: "unknown control" } };
        if (request.method !== method) return { status: 405, body: { error: `use ${method}` } };
        switch (url.pathname) {
            case "/ctl/state":
                return {
                    status: 200,
                    body: {
                        mode,
                        counts: { ...counts, open: connections.size },
                        connections: [...connections.values()].map(describe),
                        closed,
                        events,
                    },
                };
            case "/ctl/say":
                return say(query);
            case "/ctl/raw": {
                const frame = await readBody(request);
                const reached = targets(query);
                for (const connection of reached) {
                    if (!mode.silent) connection.peer.sendText(frame);
                }
                return { status: 200, body: { sent: reached.length } };
            }
            case "/ctl/reconnect": {
                const reached = targets(query);
                for (const connection of reached) send(connection, [":tmi.twitch.tv RECONNECT"]);
                return { status: 200, body: { sent: reached.length } };
            }
            case "/ctl/drop": {
                const reached = targets(query);
                for (const connection of reached) connection.peer.terminate();
                return { status: 200, body: { dropped: reached.length } };
            }
            case "/ctl/close": {
                const reached = targets(query);
                const code = Number(query.get("code") ?? 1000);
                for (const connection of reached) connection.peer.close(code);
                return { status: 200, body: { closed: reached.length } };
            }
            case "/ctl/mode":
                for (const [name, value] of query) {
                    if (!(name in mode)) {
                        return { status: 400, body: { error: `unknown mode ${name}` } };
                    }
                    mode[name] = typeof mode[name] === "number" ? Number(value) : value === "1";
                }
                return { status: 200, body: { mode } };
        }
    }

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://mock");
        control(request, url)
            .catch((error) => ({ status: 500, body: { error: String(error) } }))
            .then(({ status, body }) => {
                response.writeHead(status, { "content-type": "application/json" });
                response.end(JSON.stringify(body));
            });
    });

    server.on("upgrade", (request, socket, head) => {
        const key = request.headers["sec-websocket-key"];
        if (request.headers.upgrade?.toLowerCase() !== "websocket" || !key) {
            return refuseUpgrade(socket, 400, "Bad Request");
        }
        if (mode.refuse) {
            counts.refused++;
            return refuseUpgrade(socket, 503, "Service Unavailable");
        }
        const proof = createHash("sha1").update(`${key}${ACCEPT_GUID}`).digest("base64");
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${proof}\r\n\r\n`,
        );
        accept(socket, head);
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
    const bound = server.address().port;

    return {
        port: bound,
        url: `ws://127.0.0.1:${bound}`,
        controlUrl: `http://127.0.0.1:${bound}`,
        async close() {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            for (const connection of connections.values()) connection.peer.terminate();
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

// Only when started as a program. The module URL is a real path, the argument may be a link.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    const mock = await startMockTwitch({ port: Number(process.argv[2] ?? 0) });
    console.log(`mock Twitch IRC on ${mock.url}, control on ${mock.controlUrl}/ctl/state`);
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => mock.close().then(() => process.exit(0)));
    }
}
