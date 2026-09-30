import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";

import { TwitchIrc } from "../../src/lib/chat/irc/client";
import type { IrcMessage } from "../../src/lib/chat/irc/parse";
import { FakeWebSocket, recorder, useFakeWebSocket, useLocation } from "../helpers";

const OVERLAY = "https://chat.shiftbloom.studio/chat/Forsen";
const RELAY = "wss://chat.shiftbloom.studio/api/irc?channel=forsen";
const TWITCH = "wss://irc-ws.chat.twitch.tv:443";
const JOIN_ECHO = ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #forsen";

/** Opens the overlay on a fake clock, where the n-th retry in a row waits 2^(n-1) seconds. */
function connect(t: TestContext, page = OVERLAY) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    t.mock.method(Math, "random", () => 0.5);
    t.mock.method(console, "warn", () => {});
    t.after(useFakeWebSocket());
    t.after(useLocation(page));
    const messages = recorder<[IrcMessage]>();
    const status = recorder<[string]>();
    const irc = new TwitchIrc({ channel: "Forsen", onMessage: messages, onStatus: status });
    t.after(() => irc.close());
    return { irc, messages, status };
}

const urls = () => FakeWebSocket.instances.map((socket) => socket.url);
const latest = () => FakeWebSocket.instances.at(-1) as FakeWebSocket;

// The relay lives on the page's origin; without one, or with ?direct=1, Twitch is the only way.
for (const [page, url] of [
    [OVERLAY, RELAY],
    ["http://localhost:8787/chat/forsen", "ws://localhost:8787/api/irc?channel=forsen"],
    [`${OVERLAY}?size=2&direct=1`, TWITCH],
    ["file:///C:/overlays/chat.html", TWITCH],
]) {
    it(`connects ${page} to ${url}`, (t) => {
        connect(t, page);
        assert.equal(latest().url, url);
    });
}

it("logs in anonymously and is connected once the JOIN echo arrived", (t) => {
    const { irc, messages, status } = connect(t);
    const ws = latest();
    ws.accept();
    assert.match(
        ws.sent.join(),
        /^CAP REQ :twitch.tv\/tags twitch.tv\/commands,NICK justinfan\d+,JOIN #forsen$/,
    );
    // The relay accepts the socket and says hello before it has joined the channel at Twitch.
    ws.receive(":tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!");
    assert.deepEqual(status.calls, []);

    ws.receive(`${JOIN_ECHO}\r\nPING :tmi.twitch.tv\r\n:v!v@v.tmi.twitch.tv PRIVMSG #forsen :hi`);
    assert.deepEqual(status.calls, [["connected"]]);
    assert.equal(ws.sent.at(-1), "PONG :tmi.twitch.tv");
    const commands = messages.calls.map(([m]) => m.command);
    assert.deepEqual(commands, ["001", "PRIVMSG"], "JOIN and PING stay with the connection");

    // A keep-alive every minute; a connection that stays silent anyway is replaced.
    t.mock.timers.tick(60_000);
    assert.equal(ws.sent.at(-1), "PING :petal");
    t.mock.timers.tick(30_000);
    assert.equal(ws.readyState, 3);
    t.mock.timers.tick(1000);
    assert.deepEqual(urls(), [RELAY, RELAY]);

    irc.close();
    t.mock.timers.tick(120_000);
    assert.deepEqual(urls(), [RELAY, RELAY], "stops for good when closed");
});

it("falls back to Twitch after two relay attempts that did not join", (t) => {
    const { status } = connect(t);
    latest().drop(); // refused before the socket opened
    assert.deepEqual(urls(), [RELAY, RELAY], "the second attempt follows at once");
    latest().accept();
    t.mock.timers.tick(14_999);
    assert.deepEqual(urls(), [RELAY, RELAY]);
    t.mock.timers.tick(1);
    assert.deepEqual(urls(), [RELAY, RELAY, TWITCH], "and so does the direct connection");

    latest().accept();
    latest().receive(JOIN_ECHO);
    assert.deepEqual(status.calls, [["connecting"], ["connecting"], ["connected"]]);
    // Twitch gets no deadline: it is what the overlay did before there was a relay.
    t.mock.timers.tick(59_000);
    assert.deepEqual(urls(), [RELAY, RELAY, TWITCH]);
});

it("backs off further with every cycle in which nothing worked", (t) => {
    connect(t);
    for (const [cycle, wait] of [1000, 2000, 4000].entries()) {
        // An open socket is not a working connection and must not restart the backoff.
        latest().accept();
        latest().drop();
        latest().drop();
        latest().drop();
        t.mock.timers.tick(wait - 1);
        assert.equal(FakeWebSocket.instances.length, (cycle + 1) * 3, `cycle ${cycle + 1}`);
        t.mock.timers.tick(1);
    }
    // A working connection starts it over, and the relay has two attempts again.
    latest().accept();
    latest().receive(JOIN_ECHO);
    latest().drop();
    t.mock.timers.tick(999);
    assert.equal(FakeWebSocket.instances.length, 10, "waits before retrying");
    t.mock.timers.tick(1);
    latest().drop();
    latest().drop();
    assert.deepEqual(urls().slice(9), [RELAY, RELAY, RELAY, TWITCH]);
    // Twitch announces a restart: the overlay goes back to the relay at once.
    latest().accept();
    latest().receive(JOIN_ECHO);
    latest().receive(":tmi.twitch.tv RECONNECT");
    assert.equal(latest().url, RELAY);
});
