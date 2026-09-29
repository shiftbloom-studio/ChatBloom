import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    UPSTREAM_DEFAULTS,
    type UpstreamConfig,
    UpstreamPool,
} from "../../../src/worker/relay/upstream";
import { FakeTwitch, RecordedEvents } from "./fakes";
import { chatLine, clearRoom, notice, roomstate } from "./lines";

const URL = "wss://irc.example.test";
const SECOND = 1000;

function setup(overrides: Partial<UpstreamConfig> = {}) {
    const twitch = new FakeTwitch();
    const events = new RecordedEvents();
    const config: UpstreamConfig = { ...UPSTREAM_DEFAULTS, url: URL, ...overrides };
    const pool = new UpstreamPool(config, events.handlers, twitch);
    return { pool, twitch, events, clock: twitch.clock };
}

/** A pool whose first connection is logged in and has joined the given channels. */
function joined(channels: string[], overrides: Partial<UpstreamConfig> = {}) {
    const context = setup(overrides);
    for (const channel of channels) context.pool.want(channel);
    const socket = context.twitch.last;
    socket.login();
    socket.confirmJoins();
    return { ...context, socket };
}

function names(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

describe("UpstreamPool login", () => {
    it("connects when the first channel is wanted and logs in anonymously", () => {
        const { pool, twitch, events } = setup();
        assert.equal(twitch.sockets.length, 0);

        pool.want("alpha");
        assert.equal(twitch.sockets.length, 1);
        const socket = twitch.last;
        assert.equal(socket.url, URL);
        assert.deepEqual(socket.sent, []);

        socket.open();
        assert.deepEqual(socket.sent, [
            "CAP REQ :twitch.tv/tags twitch.tv/commands",
            "NICK justinfan54999",
        ]);

        socket.welcome();
        assert.deepEqual(socket.sent.slice(2), ["JOIN #alpha"]);
        assert.equal(pool.isJoined("alpha"), false);

        socket.echoJoin("alpha");
        assert.equal(pool.isJoined("alpha"), true);
        assert.deepEqual(events.joined, ["alpha"]);
        assert.equal(pool.status().consecutiveFailures, 0);
    });

    it("asks for a channel once, however often it is wanted", () => {
        const { pool, twitch } = setup();
        pool.want("alpha");
        pool.want("alpha");
        twitch.last.login();
        pool.want("alpha");
        assert.equal(twitch.sockets.length, 1);
        assert.deepEqual(twitch.last.joins, ["alpha"]);
    });

    it("answers the PING of Twitch", () => {
        const { socket } = joined(["alpha"]);
        socket.receive("PING :tmi.twitch.tv");
        assert.equal(socket.sent.at(-1), "PONG :tmi.twitch.tv");
    });

    it("gives up a connection that does not log in", () => {
        const { pool, twitch, clock, events } = setup();
        pool.want("alpha");
        const socket = twitch.last;
        socket.open();

        clock.advance(10 * SECOND);
        assert.equal(socket.closed, false);
        clock.advance(SECOND);
        assert.equal(socket.closed, true);
        assert.equal(events.counters["connect-failed"], 1);

        clock.advance(SECOND);
        assert.equal(twitch.sockets.length, 2);
        twitch.last.login();
        assert.deepEqual(twitch.last.joins, ["alpha"]);
    });
});

describe("UpstreamPool JOIN queue", () => {
    it("holds JOINs back until Twitch has welcomed the connection", () => {
        const { pool, twitch } = setup();
        for (const channel of ["alpha", "beta", "gamma"]) pool.want(channel);
        const socket = twitch.last;
        socket.open();
        assert.deepEqual(socket.joins, []);
        socket.welcome();
        assert.deepEqual(socket.joins, ["alpha", "beta", "gamma"]);
    });

    it("opens another connection rather than exceeding the budget of one", () => {
        const { pool, twitch, clock } = setup();
        const channels = names("channel_", 40);
        for (const channel of channels) pool.want(channel);

        // Connections are spaced, so the second and third follow with the clock.
        assert.equal(twitch.sockets.length, 1);
        clock.advance(SECOND);
        assert.equal(twitch.sockets.length, 2);
        clock.advance(SECOND);
        assert.equal(twitch.sockets.length, 3);
        clock.advance(5 * SECOND);
        assert.equal(twitch.sockets.length, 3);

        for (const socket of twitch.sockets) socket.login();
        assert.deepEqual(
            twitch.sockets.map((socket) => socket.joins.length),
            [18, 18, 4],
        );
        assert.deepEqual(twitch.sockets.flatMap((socket) => socket.joins).sort(), channels.sort());

        for (const socket of twitch.sockets) socket.confirmJoins();
        const status = pool.status();
        assert.equal(status.wanted, 40);
        assert.equal(status.joined, 40);
    });

    it("never sends more JOINs in a window than Twitch allows", () => {
        // An hour between connections: the pool has to make do with the first one.
        const { pool, twitch, clock } = setup({
            connectSpacingMs: 3600 * SECOND,
            maxChannelsPerConnection: 100,
        });
        for (const channel of names("channel_", 40)) pool.want(channel);
        const socket = twitch.last;
        socket.login();
        socket.confirmJoins();
        assert.equal(socket.joins.length, 18);

        clock.advance(10 * SECOND);
        assert.equal(socket.joins.length, 18);
        clock.advance(SECOND);
        socket.confirmJoins();
        assert.equal(socket.joins.length, 36);
        clock.advance(10 * SECOND);
        assert.equal(socket.joins.length, 36);
        clock.advance(SECOND);
        socket.confirmJoins();
        assert.equal(socket.joins.length, 40);
        assert.equal(twitch.sockets.length, 1);
        assert.equal(pool.status().joined, 40);

        const times = socket.log.filter((entry) => entry.line.startsWith("JOIN ")).map((e) => e.at);
        for (const start of times) {
            const inWindow = times.filter((at) => at >= start && at < start + 10 * SECOND);
            assert.ok(inWindow.length <= 20, `${inWindow.length} JOINs within ten seconds`);
        }
    });

    it("fills a connection up to its size and not beyond", () => {
        const { pool, twitch, clock } = setup({ maxChannelsPerConnection: 5, joinsPerWindow: 5 });
        for (const channel of names("channel_", 12)) pool.want(channel);
        clock.advance(3 * SECOND);
        for (const socket of twitch.sockets) socket.login();
        assert.deepEqual(
            twitch.sockets.map((socket) => socket.joins.length),
            [5, 5, 2],
        );
        assert.deepEqual(
            pool.status().connections.map((connection) => connection.channels),
            [5, 5, 2],
        );
    });

    it("prefers the connection with budget left over a new one", () => {
        const { pool, twitch, clock, socket } = joined(names("channel_", 3));
        clock.advance(5 * SECOND);
        pool.want("late");
        assert.equal(twitch.sockets.length, 1);
        assert.equal(socket.joins.at(-1), "late");
    });
});

describe("UpstreamPool JOIN timeout", () => {
    it("asks again with growing patience when Twitch does not answer", () => {
        const { pool, twitch, clock, events, socket } = joined(["alpha"]);
        const start = clock.now;
        pool.want("nowhere");
        const asked = () =>
            socket.log
                .filter((entry) => entry.line === "JOIN #nowhere")
                .map((entry) => (entry.at - start) / SECOND);
        assert.deepEqual(asked(), [0]);

        clock.advance(10 * SECOND);
        assert.equal(events.counters["join-timeout"], undefined);
        clock.advance(SECOND);
        assert.equal(events.counters["join-timeout"], 1);
        assert.deepEqual(asked(), [0]);

        // Ten seconds of patience after the first silence, twenty after the second.
        clock.advance(9 * SECOND);
        assert.deepEqual(asked(), [0]);
        clock.advance(SECOND);
        assert.deepEqual(asked(), [0, 21]);
        clock.advance(11 * SECOND);
        assert.equal(events.counters["join-timeout"], 2);
        clock.advance(19 * SECOND);
        assert.deepEqual(asked(), [0, 21]);
        clock.advance(SECOND);
        assert.deepEqual(asked(), [0, 21, 52]);

        assert.equal(pool.isJoined("nowhere"), false);
        assert.equal(pool.isJoined("alpha"), true);
        assert.equal(twitch.sockets.length, 1);
    });

    it("waits no longer than five minutes between two attempts", () => {
        const { pool, clock, socket } = joined(["alpha"]);
        pool.want("nowhere");
        clock.advance(3600 * SECOND);
        const times = socket.log
            .filter((entry) => entry.line === "JOIN #nowhere")
            .map((entry) => entry.at);
        const gaps = times.slice(1).map((at, index) => at - (times[index] as number));
        assert.ok(gaps.length >= 8, `${gaps.length} attempts in an hour`);
        assert.equal(Math.max(...gaps), 311 * SECOND);
        assert.deepEqual(
            gaps.slice(0, 5),
            [21, 31, 51, 91, 171].map((gap) => gap * SECOND),
        );
    });

    it("keeps the JOIN whose echo arrives after the timeout", () => {
        const { pool, clock, events, socket } = joined(["alpha"]);
        pool.want("slow");
        clock.advance(11 * SECOND);
        assert.equal(events.counters["join-timeout"], 1);

        socket.echoJoin("slow");
        assert.equal(pool.isJoined("slow"), true);
        assert.deepEqual(events.joined, ["alpha", "slow"]);

        clock.advance(60 * SECOND);
        assert.deepEqual(socket.joins, ["alpha", "slow"]);
        assert.deepEqual(socket.parts, []);
    });

    it("takes a line of chat as proof of the JOIN when the echo is missing", () => {
        const { pool, events, socket } = joined(["alpha"]);
        pool.want("beta");
        socket.receive(roomstate("beta"), chatLine("beta", { id: "m-1" }));
        assert.equal(pool.isJoined("beta"), true);
        assert.deepEqual(events.log, ["joined alpha", "joined beta", "line beta", "line beta"]);
    });

    it("passes on the NOTICE of a suspended channel without taking it for a JOIN", () => {
        const { pool, events, socket } = joined(["alpha"]);
        pool.want("suspended");
        socket.receive(notice("suspended"));
        assert.deepEqual(events.of("suspended"), [notice("suspended")]);
        assert.equal(pool.isJoined("suspended"), false);
        assert.deepEqual(events.joined, ["alpha"]);
    });
});

describe("UpstreamPool forwarding", () => {
    it("reports the lines of wanted channels and keeps the housekeeping to itself", () => {
        const { events, socket } = joined(["alpha"]);
        const first = chatLine("alpha", { id: "m-1" });
        const second = chatLine("alpha", { id: "m-2", command: "USERNOTICE" });
        socket.receive(
            `:${socket.nick}.tmi.twitch.tv 353 ${socket.nick} = #alpha :${socket.nick}`,
            `:${socket.nick}.tmi.twitch.tv 366 ${socket.nick} #alpha :End of /NAMES list`,
            roomstate("alpha"),
            first,
            "@badges=;color= :tmi.twitch.tv USERSTATE #alpha",
            ":viewer1!viewer1@viewer1.tmi.twitch.tv JOIN #alpha",
            second,
            clearRoom("alpha"),
        );
        assert.deepEqual(events.of("alpha"), [
            roomstate("alpha"),
            first,
            second,
            clearRoom("alpha"),
        ]);
    });

    it("reads frames with and without a line ending", () => {
        const { events, socket } = joined(["alpha"]);
        socket.receive(chatLine("alpha", { id: "m-1" }));
        assert.equal(events.lines.length, 1);
        assert.equal(events.lines[0]?.line.endsWith("\r\n"), false);
    });

    it("leaves a channel it finds itself joined to without having asked", () => {
        const { events, socket } = joined(["alpha"]);
        socket.receive(chatLine("stray", { id: "m-1" }));
        socket.receive(chatLine("stray", { id: "m-2" }));
        assert.deepEqual(events.of("stray"), []);
        assert.deepEqual(socket.parts, ["stray"]);
        assert.equal(events.counters["stray-channel"], 1);
    });

    it("goes on after a line that could not be handled", () => {
        const twitch = new FakeTwitch();
        const events = new RecordedEvents();
        let failing = true;
        const pool = new UpstreamPool(
            { ...UPSTREAM_DEFAULTS, url: URL },
            {
                ...events.handlers,
                line: (channel, line, info) => {
                    if (failing) throw new Error("cannot handle this line");
                    events.handlers.line(channel, line, info);
                },
            },
            twitch,
        );
        pool.want("alpha");
        const socket = twitch.last;
        socket.login();
        socket.confirmJoins();

        const lines = ["m-1", "m-2", "m-3"].map((id) => chatLine("alpha", { id }));
        socket.receive(lines[0] as string);
        failing = false;
        socket.receive(lines[1] as string, lines[2] as string);
        assert.deepEqual(events.of("alpha"), lines.slice(1));
        assert.equal(events.counters.failed, 1);
        assert.equal(socket.closed, false);
    });

    it("ignores a connection it has closed", () => {
        const { pool, events, socket } = joined(["alpha"]);
        pool.shutdown();
        socket.receive(chatLine("alpha", { id: "m-1" }));
        assert.deepEqual(events.lines, []);
    });
});

describe("UpstreamPool RECONNECT", () => {
    it("moves the channels to a new connection without a gap or a duplicate", () => {
        const { pool, twitch, clock, events, socket: old } = joined(["alpha", "beta"]);
        const line = (id: string) => chatLine("alpha", { id });
        clock.advance(5 * SECOND);
        old.receive(line("m-1"));

        old.receive(":tmi.twitch.tv RECONNECT");
        assert.equal(twitch.sockets.length, 2);
        const fresh = twitch.last;
        assert.equal(old.closed, false);
        assert.equal(pool.isJoined("alpha"), true);

        // The old connection serves until the new one has joined.
        old.receive(line("m-2"));
        fresh.login();
        assert.deepEqual(fresh.joins, ["alpha", "beta"]);
        assert.deepEqual(old.parts, []);

        fresh.echoJoin("alpha");
        assert.deepEqual(old.parts, ["alpha"]);

        // Until Twitch confirms the PART both deliver, in either order.
        old.receive(line("m-3"));
        fresh.receive(line("m-3"));
        fresh.receive(line("m-4"));
        old.receive(line("m-4"));
        fresh.receive(line("m-2"));
        old.receive(chatLine("beta", { id: "b-1" }));

        fresh.echoJoin("beta");
        old.echoPart("alpha", "beta");
        // The new connection may still be behind the old one.
        fresh.receive(line("m-4"));
        fresh.receive(line("m-5"));

        assert.deepEqual(
            events.of("alpha"),
            ["m-1", "m-2", "m-3", "m-4", "m-5"].map((id) => line(id)),
        );
        assert.deepEqual(events.of("beta"), [chatLine("beta", { id: "b-1" })]);
        assert.equal(events.counters["duplicate-dropped"], 4);
        assert.equal(events.counters.handover, 2);
        assert.deepEqual(events.lost, []);

        clock.advance(SECOND);
        assert.equal(old.closed, true);
        assert.equal(fresh.closed, false);
        assert.equal(pool.status().consecutiveFailures, 0);
        assert.equal(pool.status().joined, 2);
    });

    it("compares ids for ten seconds after the old connection has left the channel", () => {
        const { clock, events, twitch, socket: old } = joined(["alpha"]);
        const line = chatLine("alpha", { id: "m-1" });
        clock.advance(5 * SECOND);
        old.receive(":tmi.twitch.tv RECONNECT");
        old.receive(line);
        const fresh = twitch.last;
        fresh.login();
        fresh.confirmJoins();
        old.echoPart("alpha");

        clock.advance(9 * SECOND);
        fresh.receive(line);
        assert.equal(events.of("alpha").length, 1);
        assert.equal(events.counters["duplicate-dropped"], 1);

        // From here on the ids are forgotten and nothing is compared any more.
        clock.advance(2 * SECOND);
        fresh.receive(line);
        assert.equal(events.of("alpha").length, 2);
    });

    it("lets one side speak for lines that carry no id", () => {
        const { clock, events, twitch, socket: old } = joined(["alpha"]);
        clock.advance(5 * SECOND);
        old.receive(":tmi.twitch.tv RECONNECT");
        const fresh = twitch.last;
        fresh.login();
        old.receive(clearRoom("alpha"));
        fresh.echoJoin("alpha");
        old.receive(roomstate("alpha", "slow=30"));
        fresh.receive(roomstate("alpha", "slow=30"));
        assert.deepEqual(events.of("alpha"), [clearRoom("alpha"), roomstate("alpha", "slow=30")]);
    });

    it("leaves a channel whose JOIN is confirmed after the channel has moved on", () => {
        const { pool, clock, events, twitch, socket: old } = joined(["alpha"]);
        clock.advance(5 * SECOND);
        pool.want("beta");
        assert.deepEqual(old.joins, ["alpha", "beta"]);

        old.receive(":tmi.twitch.tv RECONNECT");
        old.echoJoin("beta");
        assert.deepEqual(old.parts, ["beta"]);
        assert.equal(pool.isJoined("beta"), false);

        const fresh = twitch.last;
        fresh.login();
        assert.deepEqual(fresh.joins.sort(), ["alpha", "beta"]);
        fresh.confirmJoins();
        assert.equal(pool.isJoined("beta"), true);
        assert.deepEqual(events.joined, ["alpha", "alpha", "beta"]);
    });

    it("joins again when the old connection is gone before the new one is ready", () => {
        const { pool, clock, events, twitch, socket: old } = joined(["alpha"]);
        clock.advance(5 * SECOND);
        old.receive(":tmi.twitch.tv RECONNECT");
        old.drop();
        assert.deepEqual(events.lost, ["alpha"]);
        assert.equal(pool.isJoined("alpha"), false);
        // Announced, so it does not count as a failure and nothing backs off.
        assert.equal(pool.status().consecutiveFailures, 0);

        const fresh = twitch.last;
        fresh.login();
        fresh.confirmJoins();
        assert.equal(pool.isJoined("alpha"), true);
        assert.equal(twitch.sockets.length, 2);
    });

    it("closes the old connection after a minute even if channels could not move", () => {
        const { clock, twitch, socket: old } = joined(["alpha"]);
        clock.advance(5 * SECOND);
        old.receive(":tmi.twitch.tv RECONNECT");
        twitch.last.open();

        clock.advance(60 * SECOND);
        assert.equal(old.closed, false);
        clock.advance(SECOND);
        assert.equal(old.closed, true);
    });
});

describe("UpstreamPool silent connection", () => {
    it("probes a quiet connection and keeps it when Twitch answers", () => {
        const { clock, twitch, socket } = joined(["alpha"]);
        const probes = () => socket.sent.filter((line) => line === "PING :petal-hub").length;
        clock.advance(29 * SECOND);
        assert.equal(probes(), 0);
        clock.advance(SECOND);
        assert.equal(probes(), 1);

        clock.advance(29 * SECOND);
        assert.equal(probes(), 1);
        clock.advance(600 * SECOND);
        assert.equal(probes(), 21);
        assert.equal(socket.closed, false);
        assert.equal(twitch.sockets.length, 1);
    });

    it("does not probe a connection that chat keeps busy", () => {
        const { clock, socket } = joined(["alpha"]);
        for (let index = 0; index < 12; index++) {
            clock.advance(10 * SECOND);
            socket.receive(chatLine("alpha", { id: `m-${index}` }));
        }
        assert.equal(socket.sent.includes("PING :petal-hub"), false);
    });

    it("replaces a connection that stays silent and joins its channels again", () => {
        const { pool, clock, events, twitch, socket } = joined(["alpha", "beta"]);
        socket.silent = true;
        clock.advance(30 * SECOND);
        assert.equal(socket.sent.at(-1), "PING :petal-hub");
        clock.advance(10 * SECOND);
        assert.equal(socket.closed, false);
        clock.advance(SECOND);

        assert.equal(socket.closed, true);
        assert.equal(events.counters.silent, 1);
        assert.deepEqual(events.lost, ["alpha", "beta"]);
        assert.equal(pool.isJoined("alpha"), false);

        // It had been working, so its replacement is not held back.
        assert.equal(twitch.sockets.length, 2);
        const fresh = twitch.last;
        fresh.login();
        assert.deepEqual(fresh.joins, ["alpha", "beta"]);
        fresh.confirmJoins();
        assert.equal(pool.isJoined("alpha"), true);
        assert.equal(pool.isJoined("beta"), true);
        assert.deepEqual(events.joined, ["alpha", "beta", "alpha", "beta"]);
    });
});

describe("UpstreamPool connection failures", () => {
    it("waits longer after every failed attempt, up to half a minute", () => {
        const { pool, twitch, clock, events } = setup();
        pool.want("alpha");
        for (let attempt = 0; attempt < 7; attempt++) {
            twitch.last.drop();
            const failedAt = clock.now;
            while (twitch.last.closed) clock.advance(SECOND);
            assert.equal(clock.now - failedAt, Math.min(30, 2 ** attempt) * SECOND);
        }
        assert.equal(events.counters["connect-failed"], 7);
        assert.equal(pool.status().consecutiveFailures, 7);
        assert.equal(pool.status().connections.length, 1);

        twitch.last.login();
        twitch.last.confirmJoins();
        assert.equal(pool.status().consecutiveFailures, 0);
    });

    it("survives a runtime that refuses to connect", () => {
        const { pool, twitch, clock, events } = setup();
        twitch.unreachable = true;
        pool.want("alpha");
        // Attempts at 0, 1 and 3 seconds; the next one is due at 7.
        clock.advance(3 * SECOND);
        assert.equal(twitch.sockets.length, 0);
        assert.equal(events.counters["connect-failed"], 3);
        assert.equal(pool.status().consecutiveFailures, 3);

        twitch.unreachable = false;
        clock.advance(4 * SECOND);
        assert.equal(twitch.sockets.length, 1);
        twitch.last.login();
        assert.deepEqual(twitch.last.joins, ["alpha"]);
    });

    it("joins again elsewhere when a connection breaks while sending", () => {
        const { pool, twitch, clock, events, socket } = joined(["alpha"]);
        clock.advance(20 * SECOND);
        socket.broken = true;
        pool.want("beta");

        assert.deepEqual(events.lost, ["alpha"]);
        assert.equal(twitch.sockets.length, 2);
        twitch.last.login();
        assert.deepEqual(twitch.last.joins.sort(), ["alpha", "beta"]);
    });

    it("queues behind a working connection while new ones have to wait", () => {
        const { pool, twitch, clock, socket } = joined(names("channel_", 18));
        clock.advance(SECOND);
        pool.want("late_0");
        assert.equal(twitch.sockets.length, 2);
        twitch.last.drop();

        pool.want("late_1");
        assert.equal(twitch.open.length, 1);
        assert.equal(socket.joins.length, 18);
        assert.equal(pool.status().connections[0]?.queuedJoins, 2);

        // The budget of the first connection comes back before the pool may connect again
        // would matter: the queue is served from it.
        clock.advance(10 * SECOND);
        assert.deepEqual(socket.joins.slice(18), ["late_0", "late_1"]);
    });
});

describe("UpstreamPool release", () => {
    it("leaves a channel nobody wants any more", () => {
        const { pool, events, socket } = joined(["alpha", "beta"]);
        pool.release("alpha");
        assert.deepEqual(socket.parts, ["alpha"]);
        assert.equal(pool.isJoined("alpha"), false);
        assert.equal(pool.status().wanted, 1);

        // Twitch delivers until it has worked through the PART.
        socket.receive(chatLine("alpha", { id: "m-1" }));
        socket.echoPart("alpha");
        socket.receive(chatLine("beta", { id: "b-1" }));
        assert.deepEqual(events.of("alpha"), []);
        assert.equal(events.of("beta").length, 1);
        assert.deepEqual(socket.parts, ["alpha"]);
    });

    it("never sends the JOIN of a channel that was released while it waited", () => {
        const { pool, twitch } = setup();
        pool.want("alpha");
        pool.want("beta");
        pool.release("alpha");
        twitch.last.login();
        assert.deepEqual(twitch.last.joins, ["beta"]);
        assert.deepEqual(twitch.last.parts, []);
    });

    it("takes back a JOIN that is still unanswered", () => {
        const { pool, twitch, events } = setup();
        pool.want("alpha");
        const socket = twitch.last;
        socket.login();
        pool.release("alpha");
        assert.deepEqual(socket.parts, ["alpha"]);

        socket.echoJoin("alpha");
        socket.echoPart("alpha");
        assert.deepEqual(events.joined, []);
        assert.deepEqual(socket.parts, ["alpha"]);
        assert.equal(pool.status().connections[0]?.channels, 0);
    });

    it("waits for the PART before it joins the same channel there again", () => {
        const { pool, twitch, clock, events, socket } = joined(["alpha"], {
            connectSpacingMs: 3600 * SECOND,
        });
        pool.release("alpha");
        pool.want("alpha");
        clock.advance(2 * SECOND);
        assert.deepEqual(socket.joins, ["alpha"]);

        socket.echoPart("alpha");
        clock.advance(SECOND);
        assert.deepEqual(socket.joins, ["alpha", "alpha"]);
        socket.echoJoin("alpha");
        assert.equal(pool.isJoined("alpha"), true);
        assert.deepEqual(events.joined, ["alpha", "alpha"]);
        assert.equal(pool.status().connections[0]?.channels, 1);
        assert.equal(twitch.sockets.length, 1);
    });

    it("stops waiting for a PART that Twitch never confirms", () => {
        const { pool, clock, socket } = joined(["alpha"], { connectSpacingMs: 3600 * SECOND });
        pool.release("alpha");
        pool.want("alpha");
        clock.advance(10 * SECOND);
        assert.deepEqual(socket.joins, ["alpha"]);
        clock.advance(SECOND);
        assert.deepEqual(socket.joins, ["alpha", "alpha"]);
    });

    it("joins again after a while when Twitch ends the membership", () => {
        const { pool, clock, events, socket } = joined(["alpha"]);
        socket.echoPart("alpha");
        assert.equal(pool.isJoined("alpha"), false);
        assert.deepEqual(events.lost, ["alpha"]);
        assert.equal(events.counters["parted-by-twitch"], 1);

        clock.advance(9 * SECOND);
        assert.deepEqual(socket.joins, ["alpha"]);
        clock.advance(SECOND);
        assert.deepEqual(socket.joins, ["alpha", "alpha"]);
    });

    it("closes a connection that has been without channels for half a minute", () => {
        const { pool, twitch, clock, socket } = joined(["alpha"]);
        pool.release("alpha");
        socket.echoPart("alpha");

        clock.advance(30 * SECOND);
        assert.equal(socket.closed, false);
        assert.equal(clock.timers, 1);
        clock.advance(SECOND);
        assert.equal(socket.closed, true);
        // Nothing is left that would keep a Durable Object in memory.
        assert.equal(clock.timers, 0);
        assert.equal(twitch.open.length, 0);
        assert.deepEqual(pool.status().connections, []);
    });

    it("uses the idle connection for a channel that comes within that time", () => {
        const { pool, twitch, clock, socket } = joined(["alpha"]);
        pool.release("alpha");
        socket.echoPart("alpha");
        clock.advance(20 * SECOND);

        pool.want("beta");
        assert.deepEqual(socket.joins, ["alpha", "beta"]);
        socket.confirmJoins();
        clock.advance(60 * SECOND);
        assert.equal(socket.closed, false);
        assert.equal(twitch.sockets.length, 1);
    });
});

describe("UpstreamPool shutdown", () => {
    it("closes every connection, stops its timer and forgets every channel", () => {
        const { pool, twitch, clock } = setup();
        for (const channel of names("channel_", 20)) pool.want(channel);
        clock.advance(SECOND);
        twitch.sockets[0]?.login();
        assert.equal(twitch.open.length, 2);
        assert.equal(clock.timers, 1);

        pool.shutdown();
        assert.equal(twitch.open.length, 0);
        assert.equal(clock.timers, 0);
        assert.deepEqual(pool.status(), {
            wanted: 0,
            joined: 0,
            connections: [],
            consecutiveFailures: 0,
        });
    });

    it("stays shut when the closed connections report their end", () => {
        const { pool, twitch, clock, events } = joined(["alpha"]);
        pool.shutdown();
        for (const socket of twitch.sockets) socket.drop();
        clock.advance(120 * SECOND);
        assert.equal(twitch.sockets.length, 1);
        assert.equal(clock.timers, 0);
        assert.deepEqual(events.lost, []);
        assert.equal(events.counters["connect-failed"], undefined);
    });

    it("starts again when a channel is wanted afterwards", () => {
        const { pool, twitch, clock } = joined(["alpha"]);
        pool.shutdown();
        clock.advance(SECOND);
        pool.want("beta");
        assert.equal(twitch.sockets.length, 2);
        twitch.last.login();
        assert.deepEqual(twitch.last.joins, ["beta"]);
        assert.equal(clock.timers, 1);
    });
});

describe("UpstreamPool status", () => {
    it("counts and never names", () => {
        const { pool, clock, socket } = joined(["alpha", "beta"]);
        pool.want("gamma");
        clock.advance(2 * SECOND);
        socket.receive("PING :tmi.twitch.tv");
        clock.advance(SECOND);
        const status = pool.status();
        assert.deepEqual(status, {
            wanted: 3,
            joined: 2,
            connections: [
                {
                    id: 1,
                    state: "ready",
                    channels: 3,
                    queuedJoins: 0,
                    ageMs: 3 * SECOND,
                    quietMs: SECOND,
                },
            ],
            consecutiveFailures: 0,
        });
        const text = JSON.stringify(status);
        for (const secret of ["alpha", "beta", "gamma", "justinfan"]) {
            assert.equal(text.includes(secret), false, secret);
        }
    });
});
