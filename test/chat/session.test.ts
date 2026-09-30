import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";

import { createChatSession } from "../../src/lib/chat/session";
import { FakeWebSocket, useFakeWebSocket, useLocation } from "../helpers";

const JOIN_ECHO = ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #forsen";

/** A chat line of user `u<user>`; the relay tags the lines it replays to every new connection. */
const line = (id: string, user = "1", tag = "") =>
    `@id=${id};user-id=${user}${tag} :u${user}!u${user}@u${user}.tmi.twitch.tv PRIVMSG #forsen :${id}`;
const replayed = (id: string, user?: string) => line(id, user, ";petal-replay=1");

function openSession(t: TestContext) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    // Emotes and badges are not the subject here: no provider knows anything.
    const nothing = new Response("{}", { status: 404, headers: { "x-petal-cache": "MISS" } });
    t.mock.method(globalThis, "fetch", async () => nothing.clone());
    t.after(useFakeWebSocket());
    t.after(useLocation("https://chat.shiftbloom.studio/chat/forsen"));
    const session = createChatSession("forsen");
    t.after(() => session.dispose());
    // The emote providers open sockets of their own.
    const chat = () => FakeWebSocket.instances.findLast((ws) => ws.url.includes("/api/irc"));
    /** The relay accepts a connection and sends the JOIN echo with its replay in one frame. */
    const join = (...replay: string[]) => {
        chat()?.accept();
        chat()?.receive([JOIN_ECHO, ...replay].join("\r\n"));
    };
    const ids = () => session.state.messages.map((message) => message.id);
    return { chat, join, ids };
}

it("renders a line once, however often it arrives", (t) => {
    const { chat, join, ids } = openSession(t);
    join(replayed("m1"));
    chat()?.receive(line("m2"));
    chat()?.receive(line("m2"));
    chat()?.drop();
    t.mock.timers.tick(1500);
    // m3 was sent while the overlay was away.
    join(replayed("m1"), replayed("m2"), replayed("m3"));
    assert.deepEqual(ids(), ["m1", "m2", "m3"]);
});

it("removes what moderators removed and does not bring it back", (t) => {
    const { chat, join, ids } = openSession(t);
    join(replayed("m1"), replayed("m2", "2"), replayed("m3"));
    chat()?.receive("@target-msg-id=m2 :tmi.twitch.tv CLEARMSG #forsen :x");
    chat()?.receive(replayed("m2", "2"));
    assert.deepEqual(ids(), ["m1", "m3"]);
    chat()?.receive("@target-user-id=1 :tmi.twitch.tv CLEARCHAT #forsen :u1");
    assert.deepEqual(ids(), []);
});
