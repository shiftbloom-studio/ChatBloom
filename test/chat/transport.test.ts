import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, type TestContext } from "node:test";

import { TwitchIrc } from "../../src/lib/chat/irc/client";
import type { IrcMessage } from "../../src/lib/chat/irc/parse";
import { platformOrigin } from "../../src/lib/chat/platform";
import { FakeWebSocket, recorder, useFakeWebSocket, useLocation } from "../helpers";

const OVERLAY = "https://chat.shiftbloom.studio/chat/Forsen";
const RELAY = "wss://chat.shiftbloom.studio/api/irc?channel=forsen";
const TWITCH = "wss://irc-ws.chat.twitch.tv:443";

const JOIN_ECHO = ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #forsen";
/** What the relay sends at once, before it has joined the channel at Twitch. */
const WELCOME =
    ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n" +
    ":tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!\r\n" +
    ":tmi.twitch.tv 376 justinfan1 :>";

let restoreWebSocket: () => void;
let restoreLocation = () => {};
beforeEach(() => {
    restoreWebSocket = useFakeWebSocket();
});
afterEach(() => {
    restoreWebSocket();
    restoreLocation();
    restoreLocation = () => {};
});

/** A fake clock, and a backoff without jitter: the n-th retry in a row waits 2^(n-1) seconds. */
function fakeClock(t: TestContext) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    t.mock.method(Math, "random", () => 0.5);
    return t.mock.method(console, "warn", () => {});
}

function connect(page = OVERLAY) {
    restoreLocation = useLocation(page);
    const messages = recorder<[IrcMessage]>();
    const status = recorder<[string]>();
    const irc = new TwitchIrc({ channel: "Forsen", onMessage: messages, onStatus: status });
    return { irc, messages, status };
}

const urls = () => FakeWebSocket.instances.map((socket) => socket.url);

describe("platformOrigin", () => {
    it("is the origin of a page served over http(s)", () => {
        assert.equal(platformOrigin(), undefined, "no page at all");
        for (const [page, origin] of [
            [OVERLAY, "https://chat.shiftbloom.studio"],
            ["http://localhost:3000/chat/forsen?direct=0", "http://localhost:3000"],
            [`${OVERLAY}?direct=1`, undefined],
            [`${OVERLAY}?size=2&direct=1`, undefined],
            ["file:///C:/overlays/chat.html", undefined],
        ] as const) {
            const restore = useLocation(page);
            assert.equal(platformOrigin(), origin, page);
            restore();
        }
    });
});

describe("chat transport", () => {
    it("connects to the relay first and is connected once the JOIN echo arrived", () => {
        const { irc, messages, status } = connect();
        const ws = FakeWebSocket.latest;
        assert.equal(ws.url, RELAY);
        ws.accept();
        assert.equal(ws.sent[0], "CAP REQ :twitch.tv/tags twitch.tv/commands");
        assert.match(ws.sent[1], /^NICK justinfan\d+$/);
        assert.equal(ws.sent[2], "JOIN #forsen");

        ws.receive(WELCOME);
        assert.deepEqual(status.calls, [], "the welcome alone is not a connection");

        ws.receive(
            `${JOIN_ECHO}\r\n` +
                "@room-id=22484632 :tmi.twitch.tv ROOMSTATE #forsen\r\n" +
                "@id=m1;room-id=22484632;petal-replay=1 :viewer_one!viewer_one@viewer_one.tmi.twitch.tv PRIVMSG #forsen :hello",
        );
        assert.deepEqual(status.calls, [["connected"]]);
        const chat = messages.calls.map(([m]) => m).filter((m) => !/^\d+$|^CAP$/.test(m.command));
        assert.deepEqual(
            chat.map((m) => [m.command, m.tags.id, m.tags["petal-replay"]]),
            [
                ["ROOMSTATE", undefined, undefined],
                ["PRIVMSG", "m1", "1"],
            ],
        );
        irc.close();
    });

    it("uses ws: for a page served over http", () => {
        const { irc } = connect("http://localhost:8787/chat/forsen");
        assert.equal(FakeWebSocket.latest.url, "ws://localhost:8787/api/irc?channel=forsen");
        irc.close();
    });

    it("sends the keep-alive the relay answers without waking up", (t) => {
        fakeClock(t);
        const { irc } = connect();
        const ws = FakeWebSocket.latest;
        ws.accept();
        ws.receive(JOIN_ECHO);
        t.mock.timers.tick(60_000);
        assert.equal(ws.sent.at(-1), "PING :petal");
        irc.close();
    });

    it("falls back to Twitch after two relay attempts that closed before the JOIN echo", (t) => {
        fakeClock(t);
        const { irc, status } = connect();
        FakeWebSocket.latest.drop(); // refused before the socket opened

        assert.deepEqual(urls(), [RELAY, RELAY], "the second attempt follows at once");
        const second = FakeWebSocket.latest;
        second.accept();
        second.receive(WELCOME);
        second.drop();

        assert.deepEqual(urls(), [RELAY, RELAY, TWITCH], "and so does the direct connection");
        const direct = FakeWebSocket.latest;
        direct.accept();
        assert.equal(direct.sent[2], "JOIN #forsen");
        direct.receive(JOIN_ECHO);
        assert.equal(status.calls.at(-1)?.[0], "connected");

        t.mock.timers.tick(59_000);
        assert.equal(FakeWebSocket.instances.length, 3, "stays on the direct connection");
        irc.close();
    });

    it("falls back to Twitch when the relay does not join within 15 seconds", (t) => {
        const warn = fakeClock(t);
        const { irc, status } = connect();
        const first = FakeWebSocket.latest;
        first.accept();
        first.receive(WELCOME);
        t.mock.timers.tick(14_999);
        assert.deepEqual(urls(), [RELAY]);
        t.mock.timers.tick(1);
        assert.deepEqual(urls(), [RELAY, RELAY]);
        assert.equal(first.readyState, 3, "the attempt that timed out is closed");

        const second = FakeWebSocket.latest;
        t.mock.timers.tick(5000);
        second.accept(); // the deadline starts over with the open socket
        t.mock.timers.tick(14_999);
        assert.deepEqual(urls(), [RELAY, RELAY]);
        t.mock.timers.tick(1);
        assert.deepEqual(urls(), [RELAY, RELAY, TWITCH]);
        assert.equal(warn.mock.callCount(), 2);

        // Twitch gets no deadline: it is what the overlay did before there was a relay.
        FakeWebSocket.latest.accept();
        t.mock.timers.tick(59_000);
        assert.deepEqual(urls(), [RELAY, RELAY, TWITCH]);
        assert.ok(!status.calls.some(([s]) => s === "connected"));
        irc.close();
    });

    it("gives up on a relay socket that never opens", (t) => {
        fakeClock(t);
        const { irc } = connect();
        t.mock.timers.tick(15_000);
        assert.deepEqual(urls(), [RELAY, RELAY]);
        t.mock.timers.tick(15_000);
        assert.deepEqual(urls(), [RELAY, RELAY, TWITCH]);
        irc.close();
    });

    it("reconnects to the relay with backoff when a working relay connection drops", (t) => {
        fakeClock(t);
        const { irc, status } = connect();
        const first = FakeWebSocket.latest;
        first.accept();
        first.receive(JOIN_ECHO);
        t.mock.timers.tick(15_000);
        assert.deepEqual(urls(), [RELAY], "the deadline ended with the JOIN echo");

        first.drop();
        assert.deepEqual(status.calls, [["connected"], ["connecting"]]);
        t.mock.timers.tick(999);
        assert.deepEqual(urls(), [RELAY], "waits before retrying");
        t.mock.timers.tick(1);
        assert.deepEqual(urls(), [RELAY, RELAY]);

        // The relay has two attempts again before the overlay goes to Twitch.
        FakeWebSocket.latest.drop();
        assert.deepEqual(urls(), [RELAY, RELAY, RELAY]);
        FakeWebSocket.latest.drop();
        assert.deepEqual(urls(), [RELAY, RELAY, RELAY, TWITCH]);
        irc.close();
    });

    it("reconnects to the relay when a working relay connection goes silent", (t) => {
        const warn = fakeClock(t);
        const { irc, status } = connect();
        const first = FakeWebSocket.latest;
        first.accept();
        first.receive(JOIN_ECHO);
        t.mock.timers.tick(90_000);
        assert.equal(warn.mock.callCount(), 1);
        assert.equal(first.readyState, 3);
        assert.equal(status.calls.at(-1)?.[0], "connecting");
        t.mock.timers.tick(1000);
        assert.deepEqual(urls(), [RELAY, RELAY]);
        irc.close();
    });

    it("starts with the relay again once the direct connection is lost", (t) => {
        fakeClock(t);
        const { irc } = connect();
        FakeWebSocket.latest.drop();
        FakeWebSocket.latest.drop();
        const direct = FakeWebSocket.latest;
        assert.equal(direct.url, TWITCH);
        direct.accept();
        direct.receive(JOIN_ECHO);

        direct.drop();
        assert.equal(FakeWebSocket.instances.length, 3, "waits before retrying");
        t.mock.timers.tick(1000);
        assert.equal(FakeWebSocket.latest.url, RELAY);

        const relay = FakeWebSocket.latest;
        relay.accept();
        relay.receive(JOIN_ECHO);
        t.mock.timers.tick(59_000);
        assert.equal(FakeWebSocket.latest, relay, "and stays there when it works");
        irc.close();
    });

    it("starts with the relay again when Twitch asks the direct connection to reconnect", (t) => {
        fakeClock(t);
        const { irc, status } = connect();
        FakeWebSocket.latest.drop();
        FakeWebSocket.latest.drop();
        const direct = FakeWebSocket.latest;
        direct.accept();
        direct.receive(JOIN_ECHO);

        direct.receive(":tmi.twitch.tv RECONNECT");
        assert.deepEqual(urls(), [RELAY, RELAY, TWITCH, RELAY]);
        assert.equal(direct.readyState, 3);
        assert.equal(status.calls.at(-1)?.[0], "connecting");
        irc.close();
    });

    it("backs off further with every cycle in which nothing worked", (t) => {
        fakeClock(t);
        const { irc } = connect();
        const failCycle = () => {
            const relay = FakeWebSocket.latest;
            assert.equal(relay.url, RELAY);
            // An open socket is not a working connection and must not restart the backoff.
            relay.accept();
            relay.drop();
            FakeWebSocket.latest.drop();
            assert.equal(FakeWebSocket.latest.url, TWITCH);
            FakeWebSocket.latest.drop();
        };
        for (const [cycle, wait] of [1000, 2000, 4000].entries()) {
            failCycle();
            const sockets = (cycle + 1) * 3;
            t.mock.timers.tick(wait - 1);
            assert.equal(FakeWebSocket.instances.length, sockets, `cycle ${cycle + 1} waits`);
            t.mock.timers.tick(1);
            assert.equal(FakeWebSocket.instances.length, sockets + 1);
        }

        const relay = FakeWebSocket.latest;
        relay.accept();
        relay.receive(JOIN_ECHO);
        relay.drop();
        t.mock.timers.tick(1000);
        assert.equal(FakeWebSocket.instances.length, 11, "a working connection starts it over");
        irc.close();
    });

    it("connects to Twitch directly with ?direct=1", (t) => {
        fakeClock(t);
        const { irc, status } = connect(`${OVERLAY}?direct=1`);
        const ws = FakeWebSocket.latest;
        assert.equal(ws.url, TWITCH);
        ws.accept();
        ws.receive(JOIN_ECHO);
        assert.deepEqual(status.calls, [["connected"]]);

        ws.drop();
        t.mock.timers.tick(1000);
        assert.deepEqual(urls(), [TWITCH, TWITCH], "and never tries the relay");
        irc.close();
    });

    it("connects to Twitch directly when the page has no http(s) origin", () => {
        const { irc } = connect("file:///C:/overlays/chat.html");
        assert.equal(FakeWebSocket.latest.url, TWITCH);
        irc.close();
    });

    it("stops for good when closed", (t) => {
        fakeClock(t);
        const { irc } = connect();
        FakeWebSocket.latest.accept();
        irc.close();
        t.mock.timers.tick(120_000);
        assert.deepEqual(urls(), [RELAY]);
    });
});
