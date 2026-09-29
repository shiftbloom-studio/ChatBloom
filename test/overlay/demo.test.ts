import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createDemoSession, DEMO_HOMIES_BADGES, isDemo } from "../../src/lib/chat/demo";
import type { ChatMessage, ChatSession } from "../../src/lib/chat/session";
import { DEFAULT_SETTINGS, isBotMessage, isMessageShown } from "../../src/lib/overlay/settings";

/** Every image the overlay would load for a message. */
function images(session: ChatSession, message: ChatMessage): string[] {
    const emotes = session.parts(message).flatMap((part) => {
        if (part.type !== "emote") return [];
        return [part.emote, ...part.overlays].flatMap((emote) => Object.values(emote.images));
    });
    const badges = session.badges(message).flatMap((badge) => Object.values(badge.images));
    return [...emotes, ...badges];
}

describe("isDemo", () => {
    it("is asked for with demo=1 only", () => {
        assert.equal(isDemo(new URLSearchParams("demo=1")), true);
        assert.equal(isDemo(new URLSearchParams("size=3&demo=1&fade=5")), true);
        assert.equal(isDemo(new URLSearchParams("")), false);
        assert.equal(isDemo(new URLSearchParams("demo=0")), false);
        assert.equal(isDemo(new URLSearchParams("demo")), false);
        assert.equal(isDemo(new URLSearchParams("demo=true")), false);
    });
});

describe("createDemoSession", () => {
    let session: ChatSession;
    let requests: number;
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;

    beforeEach(() => {
        mock.timers.enable({ apis: ["setTimeout"] });
        requests = 0;
        globalThis.fetch = (() => {
            requests++;
            throw new Error("the demo must not fetch");
        }) as typeof fetch;
        globalThis.WebSocket = class {
            constructor() {
                requests++;
                throw new Error("the demo must not open a socket");
            }
        } as unknown as typeof WebSocket;
        session = createDemoSession();
    });

    afterEach(() => {
        session.dispose();
        mock.timers.reset();
        globalThis.fetch = originalFetch;
        globalThis.WebSocket = originalWebSocket;
    });

    /** Lets time pass in small steps: one large step would run the first timer only. */
    function wait(milliseconds: number) {
        for (let passed = 0; passed < milliseconds; passed += 100) mock.timers.tick(100);
    }

    /** Runs the demo until it has been through all of its messages twice. */
    function rotation(): ChatMessage[] {
        wait(60_000);
        return [...session.state.messages];
    }

    it("is connected and talking from the start", () => {
        assert.equal(session.state.status, "connected");
        assert.ok(session.state.messages.length >= 3);
    });

    it("says something new every one to two seconds", () => {
        const start = session.state.messages.length;
        wait(900);
        assert.equal(session.state.messages.length, start);
        wait(1100);
        assert.equal(session.state.messages.length, start + 1);

        const before = session.state.messages.length;
        wait(20_000);
        const added = session.state.messages.length - before;
        assert.ok(added >= 10 && added <= 20, `${added} messages in 20 seconds`);
    });

    it("repeats about a dozen messages under ids of their own", () => {
        const messages = rotation();
        const texts = new Set(messages.map((message) => message.text));
        assert.ok(texts.size >= 10 && texts.size <= 14, `${texts.size} different messages`);
        assert.ok(messages.length > texts.size);
        assert.equal(new Set(messages.map((message) => message.id)).size, messages.length);
    });

    it("keeps no more than a hundred messages", () => {
        wait(300_000);
        assert.equal(session.state.messages.length, 100);
    });

    it("stops when it is disposed", () => {
        session.dispose();
        const count = session.state.messages.length;
        wait(10_000);
        assert.equal(session.state.messages.length, count);
    });

    it("shows what the filters do: a bot, a command, and chatters to ignore", () => {
        const messages = rotation();
        assert.equal(messages.filter(isBotMessage).length > 0, true);
        assert.equal(messages.filter((message) => message.text.startsWith("!")).length > 0, true);

        const hidden = { ...DEFAULT_SETTINGS, bots: false, commands: false };
        const shown = messages.filter((message) => isMessageShown(message, hidden));
        assert.ok(shown.length < messages.length);
        assert.equal(shown.filter(isBotMessage).length, 0);

        // Names from the preview can go on the ignore list of the start page.
        for (const message of messages) assert.match(message.login, /^[a-z0-9_]{1,25}$/);
    });

    it("shows a few name colours, badges, emotes and one painted name", () => {
        const messages = rotation();
        const colours = new Set(messages.map((message) => message.color));
        assert.ok(colours.size >= 4);
        for (const colour of colours) assert.match(colour, /^#[0-9a-f]{6}$/);

        const badges = new Set(
            messages.flatMap((message) => session.badges(message).map((badge) => badge.title)),
        );
        assert.ok(badges.has("Moderator"));
        assert.ok(badges.has("Subscriber"));

        const emotes = new Set(
            messages.flatMap((message) =>
                session
                    .parts(message)
                    .flatMap((part) => (part.type === "emote" ? part.emote.name : [])),
            ),
        );
        assert.ok(emotes.size >= 3);

        assert.ok(messages.some((message) => session.paint(message) !== undefined));
        assert.ok(messages.some((message) => message.action));
        assert.ok(messages.some((message) => message.system !== undefined));
        assert.ok(
            messages.some((message) =>
                session.parts(message).some((part) => part.type === "mention"),
            ),
        );
    });

    it("resolves every badge it refers to", () => {
        for (const message of rotation()) {
            assert.equal(session.badges(message).length, message.badgeRefs.length);
        }
    });

    it("uses only images that ship with the site", () => {
        const used = new Set(rotation().flatMap((message) => images(session, message)));
        assert.ok(used.size >= 6);
        for (const path of used) {
            assert.match(path, /^\/demo\/[a-z-]+\.svg$/);
            assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), path);
        }
        for (const message of rotation()) {
            const paint = session.paint(message);
            assert.doesNotMatch(JSON.stringify(paint ?? {}), /url|http|\/\//i);
        }
    });

    it("has a message of several lines among those it starts with", () => {
        const longest = Math.max(...session.state.messages.map((message) => message.text.length));
        assert.ok(longest >= 100, `the longest message has ${longest} characters`);
    });

    it("keeps the Homies badges apart, for links that switch them on", () => {
        const messages = rotation();
        for (const message of messages) {
            for (const badge of session.badges(message)) assert.notEqual(badge.provider, "homies");
        }
        const holders = messages.filter((message) => DEMO_HOMIES_BADGES.has(message.userId));
        assert.ok(holders.length > 0);
        assert.ok(holders.length < messages.length);
        // With and without badges of Twitch before them.
        assert.ok(holders.some((message) => message.badgeRefs.length > 0));
        assert.ok(holders.some((message) => message.badgeRefs.length === 0));
    });

    it("draws the Homies badges itself", () => {
        const badges = [...DEMO_HOMIES_BADGES.values()].flat();
        assert.ok(badges.length > 0);
        for (const badge of badges) {
            assert.equal(badge.provider, "homies");
            for (const path of Object.values(badge.images)) {
                assert.match(path, /^\/demo\/[a-z-]+\.svg$/);
                assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), path);
            }
        }
    });

    it("makes no request", () => {
        for (const message of rotation()) {
            session.parts(message);
            session.badges(message);
            session.paint(message);
            session.user(message);
            DEMO_HOMIES_BADGES.get(message.userId);
        }
        assert.equal(requests, 0);
    });
});
