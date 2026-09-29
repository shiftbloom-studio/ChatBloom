import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, type TestContext } from "node:test";

import { type ChatSessionOptions, createChatSession } from "../../src/lib/chat/session";
import { FakeWebSocket, useFakeWebSocket, useLocation } from "../helpers";

const RELAY = "wss://chat.shiftbloom.studio/api/irc?channel=forsen";
const JOIN_ECHO = ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #forsen";
const ROOMSTATE = "@emote-only=0;room-id=22484632 :tmi.twitch.tv ROOMSTATE #forsen";

const USERS: Record<string, string> = { viewer_one: "100000001", viewer_two: "100000002" };

function line(id: string, login = "viewer_one", replayed = false): string {
    const tags = `id=${id};room-id=22484632;user-id=${USERS[login]}${replayed ? ";petal-replay=1" : ""}`;
    return `@${tags} :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #forsen :message ${id}`;
}

const replayed = (id: string, login?: string) => line(id, login, true);

/** What the relay sends in one frame once Twitch confirmed the JOIN. */
const greeting = (...replay: string[]) => [JOIN_ECHO, ROOMSTATE, ...replay].join("\r\n");

let restoreWebSocket: () => void;
let restoreLocation: () => void;
let restoreFetch: () => void;
beforeEach(() => {
    restoreWebSocket = useFakeWebSocket();
    restoreLocation = useLocation("https://chat.shiftbloom.studio/chat/forsen");
    // Emotes and badges are not the subject here: no provider knows anything.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response("{}", {
            status: 404,
            headers: { "x-petal-cache": "MISS; layer=upstream" },
        })) as typeof fetch;
    restoreFetch = () => {
        globalThis.fetch = original;
    };
});
afterEach(() => {
    restoreWebSocket();
    restoreLocation();
    restoreFetch();
});

function openSession(t: TestContext, options?: ChatSessionOptions) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    t.mock.method(Math, "random", () => 0.5);
    const session = createChatSession("forsen", options);
    t.after(() => session.dispose());
    const chat = () => {
        const socket = FakeWebSocket.instances.findLast((ws) => ws.url === RELAY);
        assert.ok(socket, "no connection to the relay");
        return socket;
    };
    const ids = () => session.state.messages.map((message) => message.id);
    return { session, chat, ids };
}

describe("chat session", () => {
    it("renders replayed lines like any other line", (t) => {
        const { session, chat, ids } = openSession(t);
        chat().accept();
        chat().receive(greeting(replayed("m1"), replayed("m2", "viewer_two")));
        chat().receive(line("m3"));

        assert.equal(session.state.status, "connected");
        assert.equal(session.state.roomId, "22484632");
        assert.deepEqual(ids(), ["m1", "m2", "m3"]);
        assert.deepEqual(
            session.state.messages.map((m) => [m.login, m.text]),
            [
                ["viewer_one", "message m1"],
                ["viewer_two", "message m2"],
                ["viewer_one", "message m3"],
            ],
        );
    });

    it("renders a line once, however often it arrives", (t) => {
        const { chat, ids } = openSession(t);
        chat().accept();
        chat().receive(greeting(replayed("m1")));
        chat().receive(line("m2"));
        chat().receive(line("m2"));
        assert.deepEqual(ids(), ["m1", "m2"]);

        const first = chat();
        first.drop();
        t.mock.timers.tick(1000);
        assert.notEqual(chat(), first);
        chat().accept();
        // m3 was sent while the overlay was away.
        chat().receive(greeting(replayed("m1"), replayed("m2"), replayed("m3")));
        chat().receive(line("m4"));
        assert.deepEqual(ids(), ["m1", "m2", "m3", "m4"]);
    });

    it("recognises lines that have left the screen already", (t) => {
        const { chat, ids } = openSession(t, { maxMessages: 2 });
        chat().accept();
        chat().receive(greeting());
        for (const id of ["m1", "m2", "m3"]) chat().receive(line(id));
        assert.deepEqual(ids(), ["m2", "m3"]);

        chat().drop();
        t.mock.timers.tick(1000);
        chat().accept();
        chat().receive(greeting(replayed("m1")));
        assert.deepEqual(ids(), ["m2", "m3"], "m1 is not new only because it is not shown");
        chat().receive([replayed("m2"), replayed("m3"), line("m4")].join("\r\n"));
        assert.deepEqual(ids(), ["m3", "m4"]);
    });

    it("renders lines without an id, which cannot be told apart", (t) => {
        const { chat, session } = openSession(t);
        chat().accept();
        chat().receive(greeting());
        const anonymous = line("m1").replace("id=m1;", "");
        chat().receive(anonymous);
        chat().receive(anonymous);
        assert.equal(session.state.messages.length, 2);
    });

    it("removes a deleted message and does not bring it back", (t) => {
        const { chat, ids } = openSession(t);
        chat().accept();
        chat().receive(greeting(replayed("m1"), replayed("m2", "viewer_two")));
        chat().receive(line("m3"));

        chat().receive("@room-id=22484632;target-msg-id=m2 :tmi.twitch.tv CLEARMSG #forsen :x");
        assert.deepEqual(ids(), ["m1", "m3"]);

        chat().receive(replayed("m2", "viewer_two"));
        assert.deepEqual(ids(), ["m1", "m3"]);
    });

    it("removes the messages of a user who was timed out, and all of them on a clear", (t) => {
        const { chat, ids } = openSession(t);
        chat().accept();
        chat().receive(greeting(replayed("m1"), replayed("m2", "viewer_two")));
        chat().receive(line("m3"));
        chat().receive(line("m4", "viewer_two"));

        chat().receive(
            "@ban-duration=600;room-id=22484632;target-user-id=100000001 :tmi.twitch.tv CLEARCHAT #forsen :viewer_one",
        );
        assert.deepEqual(ids(), ["m2", "m4"]);

        chat().receive("@room-id=22484632 :tmi.twitch.tv CLEARCHAT #forsen");
        assert.deepEqual(ids(), []);

        chat().receive(line("m5"));
        assert.deepEqual(ids(), ["m5"]);
    });

    it("forgets the oldest ids first", (t) => {
        const { chat, ids } = openSession(t, { maxMessages: 2 });
        chat().accept();
        chat().receive(greeting());
        for (let i = 0; i <= 500; i++) chat().receive(line(`m${i}`));

        chat().receive(line("m1"));
        assert.deepEqual(ids(), ["m499", "m500"], "m1 is one of the 500 ids remembered");
        chat().receive(line("m0"));
        assert.deepEqual(ids(), ["m500", "m0"], "m0 is not");
    });
});
