import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { TwitchIrc } from "../../src/lib/chat/irc/client";
import type { IrcMessage } from "../../src/lib/chat/irc/parse";
import { BTTVSocket, type BTTVUser } from "../../src/lib/chat/providers/bttv";
import { FFZPubSub } from "../../src/lib/chat/providers/ffz";
import { channelCondition, SevenTVEvents } from "../../src/lib/chat/providers/seventv/events";
import type { Paint } from "../../src/lib/chat/providers/seventv/paint";
import { ReconnectingSocket } from "../../src/lib/chat/socket";
import type { Badge, Emote } from "../../src/lib/chat/types";
import { FakeWebSocket, recorder, useFakeWebSocket } from "../helpers";

let restoreWebSocket: () => void;
beforeEach(() => {
    restoreWebSocket = useFakeWebSocket();
});
afterEach(() => restoreWebSocket());

describe("ReconnectingSocket", () => {
    it("reconnects with backoff after a drop until stopped", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const socket = new ReconnectingSocket({
            label: "test",
            url: () => "wss://x",
            onMessage() {},
        });
        socket.start();
        FakeWebSocket.latest.accept();
        FakeWebSocket.latest.drop();
        assert.equal(FakeWebSocket.instances.length, 1, "waits before retrying");

        t.mock.timers.tick(1500); // first retry: 0.5–1.5 s
        assert.equal(FakeWebSocket.instances.length, 2);

        FakeWebSocket.latest.drop();
        socket.stop();
        t.mock.timers.tick(120_000);
        assert.equal(FakeWebSocket.instances.length, 2, "stop() cancels the pending retry");
    });

    it("reconnects immediately when the idle deadline passes", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const socket = new ReconnectingSocket({
            label: "test",
            url: () => "wss://x",
            idleTimeoutMs: 1000,
            onMessage() {},
        });
        socket.start();
        FakeWebSocket.latest.accept();
        t.mock.timers.tick(900);
        FakeWebSocket.latest.receive("heartbeat"); // pushes the deadline out
        t.mock.timers.tick(900);
        assert.equal(FakeWebSocket.instances.length, 1);
        t.mock.timers.tick(200);
        assert.equal(FakeWebSocket.instances.length, 2);
        socket.stop();
    });
});

describe("TwitchIrc", () => {
    it("logs in anonymously, answers PING and forwards messages", () => {
        const messages = recorder<[IrcMessage]>();
        const status = recorder<[string]>();
        const irc = new TwitchIrc({ channel: "Forsen", onMessage: messages, onStatus: status });
        const ws = FakeWebSocket.latest;
        ws.accept();

        assert.equal(ws.sent[0], "CAP REQ :twitch.tv/tags twitch.tv/commands");
        assert.match(ws.sent[1], /^NICK justinfan\d+$/);
        assert.equal(ws.sent[2], "JOIN #forsen");

        ws.receive(
            ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #forsen\r\n" +
                "PING :tmi.twitch.tv\r\n" +
                "@room-id=22484632 :tmi.twitch.tv ROOMSTATE #forsen\r\n",
        );
        assert.deepEqual(status.calls, [["connected"]]);
        assert.equal(ws.sent.at(-1), "PONG :tmi.twitch.tv");
        assert.deepEqual(
            messages.calls.map(([m]) => [m.command, m.tags["room-id"]]),
            [["ROOMSTATE", "22484632"]],
        );
        irc.close();
    });
});

describe("7TV EventAPI", () => {
    const handlers = () => ({
        onEmoteSetChange: recorder(),
        onEmoteSetCreate: recorder<[string, number]>(),
        onPaint: recorder<[Paint]>(),
        onBadge: recorder<[Badge]>(),
        onEntitlement: recorder(),
        onUserEmoteSet: recorder<[string, string]>(),
    });

    it("sends subscriptions once the server says hello, and after every reconnect", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const events = new SevenTVEvents(handlers());
        events.subscribe("entitlement.*", channelCondition("22484632"));
        const ws = FakeWebSocket.latest;
        ws.accept();
        assert.deepEqual(ws.sent, [], "nothing before the hello");

        ws.receive({ op: 1, d: { heartbeat_interval: 45_000, session_id: "s" } });
        assert.deepEqual(ws.sentJson, [
            {
                op: 35,
                d: {
                    type: "entitlement.*",
                    condition: { ctx: "channel", platform: "TWITCH", id: "22484632" },
                },
            },
        ]);

        events.subscribe("emote_set.*", { object_id: "set" });
        events.subscribe("emote_set.*", { object_id: "set" });
        assert.equal(ws.sent.length, 2, "live subscribe is sent once");

        ws.receive({ op: 4, d: {} }); // server asks us to reconnect
        t.mock.timers.tick(1500);
        const next = FakeWebSocket.latest;
        assert.notEqual(next, ws);
        next.accept();
        next.receive({ op: 1, d: { heartbeat_interval: 45_000, session_id: "s2" } });
        assert.deepEqual(
            next.sentJson.map((frame) => (frame as { d: { type: string } }).d.type),
            ["entitlement.*", "emote_set.*"],
        );
        events.close();
    });

    it("replaces a connection that falls silent after its first heartbeat", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const events = new SevenTVEvents(handlers());
        const ws = FakeWebSocket.latest;
        ws.accept();
        ws.receive({ op: 1, d: { heartbeat_interval: 1000, session_id: "s" } });
        ws.receive({ op: 2, d: { count: 1 } });

        t.mock.timers.tick(2999);
        assert.equal(FakeWebSocket.latest, ws, "three missed heartbeats are not over yet");
        t.mock.timers.tick(1);
        assert.notEqual(FakeWebSocket.latest, ws, "silence after a heartbeat must reconnect");
        events.close();
    });

    it("routes dispatches to the right handlers", () => {
        const h = handlers();
        const events = new SevenTVEvents(h);
        const ws = FakeWebSocket.latest;
        ws.accept();
        const dispatch = (type: string, body: unknown) => ws.receive({ op: 0, d: { type, body } });
        const user = { id: "u", connections: [{ platform: "TWITCH", id: "100000003" }] };

        dispatch("entitlement.create", { id: "0", object: { kind: "PAINT", ref_id: "p1", user } });
        dispatch("entitlement.delete", { id: "0", object: { kind: "BADGE", ref_id: "b1", user } });
        dispatch("cosmetic.create", {
            id: "p1",
            object: {
                kind: "PAINT",
                data: {
                    id: "p1",
                    name: "Pink Princess",
                    function: "LINEAR_GRADIENT",
                    color: null,
                    repeat: false,
                    angle: 0,
                    stops: [{ at: 0, color: -1 }],
                    shadows: [],
                },
            },
        });
        dispatch("cosmetic.create", {
            id: "b1",
            object: {
                kind: "BADGE",
                data: {
                    id: "b1",
                    tooltip: "7TV Subscriber",
                    host: {
                        url: "//cdn.7tv.app/badge/b1",
                        files: [{ name: "1x.webp", width: 18, height: 18, format: "WEBP" }],
                    },
                },
            },
        });
        dispatch("emote_set.create", { id: "personal", object: { id: "personal", flags: 4 } });
        dispatch("user.update", {
            id: "7tv-user",
            updated: [
                {
                    key: "connections",
                    index: 0,
                    value: [{ key: "emote_set", old_value: { id: "old" }, value: { id: "new" } }],
                },
            ],
        });

        assert.deepEqual(h.onEntitlement.calls, [
            [{ kind: "PAINT", refId: "p1", twitchId: "100000003" }, true],
            [{ kind: "BADGE", refId: "b1", twitchId: "100000003" }, false],
        ]);
        assert.equal(h.onPaint.calls[0][0].name, "Pink Princess");
        assert.deepEqual(h.onBadge.calls[0][0].images, {
            1: "https://cdn.7tv.app/badge/b1/1x.webp",
        });
        assert.deepEqual(h.onEmoteSetCreate.calls, [["personal", 4]]);
        assert.deepEqual(h.onUserEmoteSet.calls, [["7tv-user", "new"]]);
        events.close();
    });
});

describe("BTTV socket", () => {
    it("joins channels on connect and routes emote and user events", () => {
        const h = {
            onEmoteAdd: recorder<[string, Emote]>(),
            onEmoteRename: recorder(),
            onEmoteRemove: recorder(),
            onUser: recorder<[BTTVUser]>(),
        };
        const socket = new BTTVSocket(h);
        socket.join("22484632");
        const ws = FakeWebSocket.latest;
        ws.accept();
        assert.deepEqual(ws.sentJson, [
            { name: "join_channel", data: { name: "twitch:22484632" } },
        ]);

        const channel = "twitch:22484632";
        ws.receive({ name: "emote_create", data: { channel, emote: { id: "e1", code: "New" } } });
        ws.receive({
            name: "emote_update",
            data: { channel, emote: { id: "e1", code: "Renamed" } },
        });
        ws.receive({ name: "emote_delete", data: { channel, emoteId: "e1" } });
        // Trimmed from a lookup_user frame captured on 2026-09-29.
        ws.receive({
            name: "lookup_user",
            data: {
                providerId: "100000002",
                pro: true,
                glow: false,
                usernameEffect: "iridescence",
                badge: { url: "https://cdn.betterttv.net/badges/pro/x.webp" },
                emotes: [
                    { id: "659898afda49e66ae974ab03", code: "uhmWait", width: 40, height: 28 },
                ],
            },
        });

        assert.equal(h.onEmoteAdd.calls[0][0], "22484632");
        assert.equal(h.onEmoteAdd.calls[0][1].name, "New");
        assert.deepEqual(h.onEmoteRename.calls, [["22484632", "e1", "Renamed"]]);
        assert.deepEqual(h.onEmoteRemove.calls, [["22484632", "e1"]]);
        const [user] = h.onUser.calls[0];
        assert.equal(user.twitchId, "100000002");
        assert.equal(user.effect, "iridescence");
        assert.equal(user.badge?.images[1], "https://cdn.betterttv.net/badges/pro/x.webp");
        assert.deepEqual(
            user.emotes.map((e) => [e.name, e.width]),
            [["uhmWait", 40]],
        );
        socket.close();
    });
});

describe("FFZ pubsub", () => {
    it("puts topics in the URL, reconnects to add a room and routes emote edits", () => {
        const h = { onEmoteAdd: recorder<[string, Emote]>(), onEmoteRemove: recorder() };
        const pubsub = new FFZPubSub(h);
        assert.equal(FakeWebSocket.latest.url, "wss://pubsub.workers.frankerfacez.com/ws?t=global");

        pubsub.subscribe("22484632");
        pubsub.subscribe("22484632");
        assert.equal(FakeWebSocket.instances.length, 2, "one reconnect per new topic");
        assert.equal(
            FakeWebSocket.latest.url,
            "wss://pubsub.workers.frankerfacez.com/ws?t=global&t=twitch%2F22484632",
        );

        const ws = FakeWebSocket.latest;
        ws.accept();
        ws.receive({ msg: "pong", time: 1 });
        const topic = "twitch/22484632";
        ws.receive({
            topic,
            data: {
                cmd: "add_emote",
                data: {
                    set_id: 1234,
                    emote: {
                        id: 5,
                        name: "ffzNew",
                        width: 28,
                        height: 28,
                        urls: { 1: "https://cdn.frankerfacez.com/emote/5/1" },
                    },
                },
            },
        });
        ws.receive({ topic, data: { cmd: "remove_emote", data: { set_id: 1234, emote_id: 5 } } });

        assert.equal(h.onEmoteAdd.calls[0][0], "1234");
        assert.equal(h.onEmoteAdd.calls[0][1].name, "ffzNew");
        assert.deepEqual(h.onEmoteRemove.calls, [["1234", "5"]]);
        pubsub.close();
    });
});
