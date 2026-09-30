import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UPSTREAM_DEFAULTS, UpstreamPool } from "../../../src/worker/relay/upstream";
import { FakeTwitch } from "./fakes";
import { chatLine, joinEcho } from "./lines";

const SECOND = 1000;

/** A pool that wants the given channels, with the lines it reported and the channels it lost. */
function setup(channels: string[], overrides: Partial<typeof UPSTREAM_DEFAULTS> = {}) {
    const twitch = new FakeTwitch();
    const reported: string[] = [];
    const events = {
        line: (_channel: string, line: string) => reported.push(line),
        lost: (channel: string) => reported.push(`lost ${channel}`),
        joined: () => {},
        count: () => {},
    };
    const config = { ...UPSTREAM_DEFAULTS, url: "wss://irc.example.test", ...overrides };
    const pool = new UpstreamPool(config, events, twitch);
    for (const channel of channels) pool.want(channel);
    return { pool, twitch, reported, socket: twitch.last };
}

/** A pool whose first connection is logged in and has joined the given channels. */
function joined(channels: string[]) {
    const context = setup(channels);
    context.socket.login();
    context.socket.confirmJoins();
    return context;
}

describe("UpstreamPool", () => {
    it("never sends more JOINs in a window than Twitch allows", () => {
        // An hour between connections: the pool has to make do with the first one.
        const config = { connectSpacingMs: 3600 * SECOND, maxChannelsPerConnection: 100 };
        const names = Array.from({ length: 40 }, (_, index) => `channel_${index}`);
        const { twitch, socket } = setup(names, config);
        socket.login();
        for (let second = 0; second < 30; second++) {
            socket.confirmJoins();
            twitch.advance(SECOND);
        }
        assert.deepEqual(socket.channels().sort(), names.sort());
        assert.equal(twitch.sockets.length, 1);
        const times = socket.log.filter((entry) => entry.line.startsWith("JOIN ")).map((e) => e.at);
        for (const start of times) {
            const inWindow = times.filter((at) => at >= start && at < start + 10 * SECOND);
            assert.ok(inWindow.length <= 20, `${inWindow.length} JOINs within ten seconds`);
        }
    });

    it("asks again for an unanswered JOIN with growing patience, up to five minutes", () => {
        const { pool, twitch, socket } = joined(["alpha"]);
        pool.want("nowhere");
        twitch.advance(3600 * SECOND);
        const times = socket.log.filter((entry) => entry.line === "JOIN #nowhere").map((e) => e.at);
        const gaps = times.slice(1).map((at, index) => (at - (times[index] as number)) / SECOND);
        assert.deepEqual(gaps.slice(0, 5), [21, 31, 51, 91, 171]);
        assert.equal(Math.max(...gaps), 311);
        assert.equal(pool.isJoined("alpha"), true);
    });

    it("waits longer after every failed connection, up to half a minute", () => {
        const { pool, twitch } = setup(["alpha"]);
        for (let attempt = 0; attempt < 7; attempt++) {
            twitch.last.events.closed();
            const failedAt = twitch.time;
            while (twitch.last.closed) twitch.advance(SECOND);
            assert.equal(twitch.time - failedAt, Math.min(30, 2 ** attempt) * SECOND);
        }
        twitch.last.login();
        twitch.last.confirmJoins();
        assert.equal(pool.status().consecutiveFailures, 0);
    });

    it("moves the channels on RECONNECT without a gap or a duplicate", () => {
        const { twitch, reported, socket: old } = joined(["alpha"]);
        const line = (id: string) => chatLine("alpha", id);
        twitch.advance(5 * SECOND);
        // The old connection serves until the new one has joined.
        old.receive(line("m-1"), ":tmi.twitch.tv RECONNECT", line("m-2"));
        const fresh = twitch.last;
        fresh.login();
        fresh.confirmJoins();
        assert.deepEqual(old.channels("PART"), ["alpha"]);

        // Until Twitch confirms the PART both deliver, in either order.
        old.receive(line("m-3"));
        fresh.receive(line("m-3"), line("m-4"), line("m-2"));
        old.receive(line("m-4"), joinEcho(old.nick, "alpha", "PART"));
        fresh.receive(line("m-4"), line("m-5"));
        assert.deepEqual(reported, ["m-1", "m-2", "m-3", "m-4", "m-5"].map(line));
        twitch.advance(SECOND);
        assert.equal(old.closed, true);
    });

    it("keeps a quiet connection that answers and replaces one that stays silent", () => {
        const { pool, twitch, reported, socket } = joined(["alpha"]);
        twitch.advance(600 * SECOND);
        assert.equal(socket.closed, false);
        socket.silent = true;
        twitch.advance(45 * SECOND);
        assert.equal(socket.closed, true);
        assert.deepEqual(reported, ["lost alpha"]);
        twitch.last.login();
        twitch.last.confirmJoins();
        assert.equal(pool.isJoined("alpha"), true);
    });
});
