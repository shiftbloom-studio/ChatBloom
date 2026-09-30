import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChatHub, type HubEnv, type HubStatus } from "../../src/worker/hub";
import { HUB_DEFAULTS, type HubConfig, HubCore } from "../../src/worker/relay/core";
import { UPSTREAM_DEFAULTS } from "../../src/worker/relay/upstream";
import { FakeClientSocket, FakeClock, FakeHost, FakeTwitch } from "./relay/fakes";
import { chatLine, clearMessage, joinEcho, roomstate } from "./relay/lines";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const CAPABILITIES = "CAP REQ :twitch.tv/tags twitch.tv/commands";
const REPLAYED = "@petal-replay=1;";

/** A hub with everything around it: the runtime's side, Twitch's side and the clock. */
class Rig {
    readonly clock = new FakeClock();
    readonly host = new FakeHost(this.clock);
    readonly config: HubConfig;
    twitch = new FakeTwitch(this.clock);
    core: HubCore<FakeClientSocket>;

    constructor(overrides: Partial<HubConfig> = {}) {
        this.config = {
            ...HUB_DEFAULTS,
            upstream: { ...UPSTREAM_DEFAULTS, url: "wss://irc.example.test" },
            ...overrides,
        };
        this.core = new HubCore(this.config, this.host, this.twitch);
    }

    /** What the Worker's upgrade request leads to. */
    async connect(channel: string): Promise<FakeClientSocket> {
        const socket = new FakeClientSocket();
        this.host.accepted.push(socket);
        await this.core.accepted(socket, channel);
        return socket;
    }

    /** An overlay that connects and says what overlays say. Its frames start with the JOIN. */
    async join(channel: string, nick = "justinfan777"): Promise<FakeClientSocket> {
        const socket = await this.connect(channel);
        await this.core.message(socket, CAPABILITIES);
        await this.core.message(socket, `NICK ${nick}`);
        socket.frames.length = 0;
        await this.core.message(socket, `JOIN #${channel}`);
        return socket;
    }

    /** An overlay on a channel that Twitch has confirmed. */
    async joinLive(channel: string, nick?: string): Promise<FakeClientSocket> {
        const socket = await this.join(channel, nick);
        const upstream = this.twitch.last;
        if (upstream.nick === "") upstream.login();
        upstream.confirmJoins();
        return socket;
    }

    /** The overlay went away and the runtime says so. */
    async leave(socket: FakeClientSocket): Promise<void> {
        socket.close(1000);
        await this.core.closed(socket);
    }

    /** Lets the time pass until the alarm is due and runs it, as the runtime does. */
    async alarm(): Promise<void> {
        const at = this.host.alarmAt;
        assert.ok(at !== null, "no alarm is set");
        if (at > this.clock.now) this.clock.advance(at - this.clock.now);
        this.host.alarmAt = null;
        await this.core.alarm();
    }

    /** Runs alarms until the given time has passed or none is set any more. */
    async pass(ms: number): Promise<void> {
        const end = this.clock.now + ms;
        while (this.host.alarmAt !== null && this.host.alarmAt <= end) await this.alarm();
        if (end > this.clock.now) this.clock.advance(end - this.clock.now);
    }

    /** The object left memory and was built again; the sockets stayed connected. */
    async rebuild(): Promise<void> {
        this.twitch = new FakeTwitch(this.clock);
        this.core = new HubCore(this.config, this.host, this.twitch);
        await this.core.restore();
    }

    status(): HubStatus {
        return this.core.status(0);
    }
}

describe("hub client protocol", () => {
    it("acknowledges the capabilities and welcomes the nick", async () => {
        const rig = new Rig();
        const socket = await rig.connect("alpha");
        await rig.core.message(socket, CAPABILITIES);
        assert.deepEqual(socket.frames, [
            ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands",
        ]);

        await rig.core.message(socket, "NICK justinfan4711");
        assert.equal(socket.frames.length, 2);
        const welcome = socket.frames[1]?.split("\r\n") ?? [];
        assert.deepEqual(
            welcome.map((line) => line.split(" ").slice(0, 3).join(" ")),
            ["001", "002", "003", "004", "375", "372", "376"].map(
                (numeric) => `:tmi.twitch.tv ${numeric} justinfan4711`,
            ),
        );
    });

    it("only takes the anonymous form of a nick", async () => {
        const rig = new Rig();
        for (const nick of ["somebody", "justinfan", "justinfan12x", "justinfan1 :x"]) {
            const socket = await rig.connect("alpha");
            await rig.core.message(socket, `NICK ${nick}`);
            assert.ok(socket.frames[0]?.startsWith(":tmi.twitch.tv 001 justinfan12345 "), nick);
        }
    });

    it("sends the JOIN echo in one frame once Twitch has confirmed the JOIN", async () => {
        const rig = new Rig();
        const socket = await rig.join("alpha");
        assert.deepEqual(socket.frames, []);
        assert.equal(rig.twitch.sockets.length, 1);

        const upstream = rig.twitch.last;
        upstream.login();
        assert.deepEqual(upstream.joins, ["alpha"]);
        assert.deepEqual(socket.frames, []);

        upstream.echoJoin("alpha");
        assert.deepEqual(socket.frames, [joinEcho("justinfan777", "alpha")]);

        // What follows is what Twitch sends, line by line and untouched.
        const line = chatLine("alpha", { id: "m-1" });
        upstream.receive(roomstate("alpha"), line);
        assert.deepEqual(socket.frames.slice(1), [roomstate("alpha"), line]);
    });

    it("greets a later overlay with room state and replay in the same frame", async () => {
        const rig = new Rig();
        const first = await rig.joinLive("alpha");
        const upstream = rig.twitch.last;
        const lines = ["m-1", "m-2", "m-3"].map((id) => chatLine("alpha", { id }));
        upstream.receive(roomstate("alpha"), ...lines);
        upstream.receive("@room-id=1;slow=30 :tmi.twitch.tv ROOMSTATE #alpha");
        upstream.receive(clearMessage("alpha", "m-2"));

        const second = await rig.join("alpha", "justinfan888");
        assert.equal(second.frames.length, 1);
        assert.deepEqual(second.frames[0]?.split("\r\n"), [
            joinEcho("justinfan888", "alpha"),
            "@emote-only=0;followers-only=-1;r9k=0;room-id=1;slow=30;subs-only=0 " +
                ":tmi.twitch.tv ROOMSTATE #alpha",
            `${REPLAYED}${lines[0]?.slice(1)}`,
            `${REPLAYED}${lines[2]?.slice(1)}`,
        ]);
        // Asked of Twitch once, and the first overlay is not greeted again.
        assert.deepEqual(upstream.joins, ["alpha"]);
        assert.equal(first.lines.filter((line) => line.includes(" JOIN ")).length, 1);

        const next = chatLine("alpha", { id: "m-4" });
        upstream.receive(next);
        assert.equal(first.frames.at(-1), next);
        assert.equal(second.frames.at(-1), next);
    });

    it("keeps no more replay than configured", async () => {
        const rig = new Rig({ replayLines: 2 });
        await rig.joinLive("alpha");
        for (const id of ["m-1", "m-2", "m-3"]) rig.twitch.last.receive(chatLine("alpha", { id }));
        const late = await rig.join("alpha");
        const replayed = late.lines.filter((line) => line.startsWith(REPLAYED));
        assert.deepEqual(
            replayed.map((line) => /;id=([^;]+);/.exec(line)?.[1]),
            ["m-2", "m-3"],
        );
        assert.equal(rig.status().replayLines, 2);
    });

    it("keeps the channels apart", async () => {
        const rig = new Rig();
        const alpha = await rig.joinLive("alpha");
        const beta = await rig.joinLive("beta");
        rig.twitch.last.receive(chatLine("alpha", { id: "m-1" }));
        assert.equal(alpha.frames.length, 2);
        assert.deepEqual(beta.frames, [joinEcho("justinfan777", "beta")]);
    });

    it("sends nothing of a channel before its JOIN echo", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        const upstream = rig.twitch.last;
        // The connection is lost; a second overlay arrives before the channel is back.
        rig.clock.advance(20 * SECOND);
        upstream.drop();
        const late = await rig.join("alpha");
        const fresh = rig.twitch.last;
        assert.notEqual(fresh, upstream);
        fresh.login();
        assert.deepEqual(late.frames, []);
        fresh.confirmJoins();
        assert.equal(late.frames.length, 1);
        assert.equal(late.lines[0], joinEcho("justinfan777", "alpha"));
    });

    it("reads several lines from one frame", async () => {
        const rig = new Rig();
        const socket = await rig.connect("alpha");
        await rig.core.message(socket, `${CAPABILITIES}\r\nNICK justinfan9\r\nJOIN #alpha\r\n`);
        rig.twitch.last.login();
        rig.twitch.last.confirmJoins();
        assert.equal(socket.frames.length, 3);
        assert.equal(socket.frames[2], joinEcho("justinfan9", "alpha"));
    });

    it("takes the channel with or without the hash and in any case", async () => {
        const rig = new Rig();
        const socket = await rig.connect("alpha");
        await rig.core.message(socket, "join ALPHA");
        assert.equal(socket.closeCode, undefined);
        assert.equal(rig.status().channels, 1);
    });

    it("answers a PING that is not the keep-alive and ignores what it does not know", async () => {
        const rig = new Rig();
        const socket = await rig.joinLive("alpha");
        socket.frames.length = 0;
        await rig.core.message(socket, "PING :something");
        await rig.core.message(socket, "PASS SCHMOOPIIE");
        await rig.core.message(socket, "PRIVMSG #alpha :overlays do not write");
        await rig.core.message(socket, "JOIN #alpha");
        await rig.core.message(socket, "");
        assert.deepEqual(socket.frames, [":tmi.twitch.tv PONG tmi.twitch.tv :something"]);
        assert.equal(socket.closeCode, undefined);
        assert.deepEqual(rig.twitch.last.joins, ["alpha"]);
        assert.equal(
            rig.twitch.last.sent.some((line) => line.includes("PRIVMSG")),
            false,
        );
    });

    it("closes when the overlay says goodbye", async () => {
        const rig = new Rig();
        const socket = await rig.joinLive("alpha");
        await rig.core.message(socket, "PART #alpha");
        assert.equal(socket.closeCode, 1000);
        assert.equal(rig.status().clients, 0);
    });
});

describe("hub protection", () => {
    it("closes an overlay that asks for another channel than it connected for", async () => {
        const rig = new Rig();
        const socket = await rig.connect("alpha");
        await rig.core.message(socket, "JOIN #beta");
        assert.equal(socket.closeCode, 1008);
        assert.equal(rig.status().clients, 0);
        assert.equal(rig.status().channels, 0);
        assert.equal(rig.twitch.sockets.length, 0);

        const several = await rig.connect("alpha");
        await rig.core.message(several, "JOIN #alpha,#beta");
        assert.equal(several.closeCode, 1008);
    });

    it("refuses overlays beyond its limit before the upgrade", async () => {
        const rig = new Rig({ maxClients: 2 });
        assert.equal(rig.core.refusal("alpha"), undefined);
        const first = await rig.join("alpha");
        await rig.connect("beta");
        assert.equal(rig.core.refusal("alpha"), "hub_full");
        assert.equal(rig.core.refusal("gamma"), "hub_full");

        await rig.leave(first);
        assert.equal(rig.core.refusal("gamma"), undefined);
        assert.equal(rig.status().counters["refused-clients"], 2);
    });

    it("refuses channels beyond its limit and keeps serving the ones it has", async () => {
        const rig = new Rig({ maxChannels: 2 });
        await rig.joinLive("alpha");
        // Connected before the limit was reached, but not joined yet.
        const undecided = await rig.connect("gamma");
        await rig.joinLive("beta");

        assert.equal(rig.core.refusal("gamma"), "channels_full");
        assert.equal(rig.core.refusal("alpha"), undefined);
        const more = await rig.join("alpha");
        assert.equal(more.closeCode, undefined);

        await rig.core.message(undecided, "JOIN #gamma");
        assert.equal(undecided.closeCode, 1013);
        assert.equal(rig.status().channels, 2);
        assert.deepEqual(rig.twitch.last.joins, ["alpha", "beta"]);
    });

    it("gives the place of a channel nobody watches to one somebody wants", async () => {
        const rig = new Rig({ maxChannels: 2 });
        const alpha = await rig.joinLive("alpha");
        const beta = await rig.joinLive("beta");
        await rig.leave(alpha);
        rig.clock.advance(SECOND);
        await rig.leave(beta);

        assert.equal(rig.core.refusal("gamma"), undefined);
        const gamma = await rig.joinLive("gamma");
        assert.equal(gamma.closeCode, undefined);
        assert.equal(rig.status().channels, 2);
        // The one that has been empty for longer went.
        assert.deepEqual(rig.twitch.last.parts, ["alpha"]);
    });

    it("closes an overlay that sends more than an overlay has to say", async () => {
        const rig = new Rig();
        const socket = await rig.joinLive("alpha");
        await rig.core.message(socket, `PING :${"x".repeat(1018)}`);
        assert.equal(socket.closeCode, undefined);
        await rig.core.message(socket, `PING :${"x".repeat(1019)}`);
        assert.equal(socket.closeCode, 1009);
        assert.equal(rig.status().clients, 0);

        const binary = await rig.joinLive("alpha");
        await rig.core.message(binary, new ArrayBuffer(4));
        assert.equal(binary.closeCode, 1003);
        assert.equal(rig.status().counters["client-frame-refused"], 2);
    });

    it("closes an overlay that talks more often than an overlay does", async () => {
        const rig = new Rig();
        const socket = await rig.joinLive("alpha");
        const quiet = await rig.joinLive("alpha");
        // The three frames of the login are counted.
        for (let index = 0; index < 17; index++) await rig.core.message(socket, "PING :again");
        assert.equal(socket.closeCode, undefined);
        assert.equal(socket.frames.length, 18);

        await rig.core.message(socket, "PING :again");
        assert.equal(socket.closeCode, 1008);
        assert.equal(socket.closeReason, "too many frames");
        assert.equal(socket.frames.length, 18);
        assert.equal(rig.status().counters["client-frame-refused"], 1);
        assert.equal(rig.status().clients, 1);
        assert.equal(quiet.closeCode, undefined);
        assert.deepEqual(rig.host.pauses, []);
    });

    it("closes a socket that has not sent its JOIN after thirty seconds", async () => {
        const rig = new Rig();
        const silent = await rig.connect("alpha");
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);

        rig.clock.advance(10 * SECOND);
        const prompt = await rig.join("beta");
        const late = await rig.connect("gamma");

        await rig.pass(21 * SECOND);
        assert.equal(silent.closeCode, 1008);
        assert.equal(late.closeCode, undefined);
        assert.equal(prompt.closeCode, undefined);

        await rig.pass(20 * SECOND);
        assert.equal(late.closeCode, 1008);
        assert.equal(prompt.closeCode, undefined);
        assert.equal(rig.status().counters["client-never-joined"], 2);
        assert.equal(rig.twitch.last.joins.includes("alpha"), false);
    });

    it("closes an overlay whose keep-alive has stopped", async () => {
        const rig = new Rig();
        const healthy = await rig.joinLive("alpha");
        const gone = await rig.joinLive("alpha");
        // The runtime answers keep-alives without telling the hub, which has to ask.
        const start = rig.clock.now;
        for (let minute = 0; minute < 10; minute++) {
            rig.host.keepAlives.set(healthy, rig.clock.now);
            if (minute < 2) rig.host.keepAlives.set(gone, rig.clock.now);
            await rig.pass(60 * SECOND);
            rig.twitch.last.receive(chatLine("alpha", { id: `m-${minute}` }));
        }
        // Its last keep-alive came after one minute, so it has ten more.
        await rig.pass(59 * SECOND);
        assert.equal(gone.closeCode, undefined);
        assert.equal(gone.frames.length, 11);
        await rig.pass(SECOND);
        assert.equal(rig.clock.now - start, 660 * SECOND);
        assert.equal(gone.closeCode, 1001);
        assert.equal(healthy.closeCode, undefined);
        assert.equal(rig.status().counters["client-stale"], 1);
    });

    it("closes a socket it knows nothing about", async () => {
        const rig = new Rig();
        const socket = new FakeClientSocket();
        await rig.core.message(socket, "JOIN #alpha");
        assert.equal(socket.closeCode, 1011);
        await rig.core.closed(socket);
        assert.equal(rig.status().clients, 0);
    });
});

describe("hub lifecycle", () => {
    it("keeps a channel joined for a minute after its last overlay left", async () => {
        const rig = new Rig();
        const socket = await rig.joinLive("alpha");
        const upstream = rig.twitch.last;
        upstream.receive(roomstate("alpha"), chatLine("alpha", { id: "m-1" }));
        await rig.leave(socket);
        assert.equal(rig.status().idleChannels, 1);

        await rig.pass(50 * SECOND);
        upstream.receive(chatLine("alpha", { id: "m-2" }));
        const back = await rig.join("alpha");
        assert.deepEqual(
            back.lines.map((line) => line.slice(0, 40)),
            [
                joinEcho("justinfan777", "alpha"),
                roomstate("alpha"),
                `${REPLAYED}${chatLine("alpha", { id: "m-1" }).slice(1)}`,
                `${REPLAYED}${chatLine("alpha", { id: "m-2" }).slice(1)}`,
            ].map((line) => line.slice(0, 40)),
        );
        assert.deepEqual(upstream.joins, ["alpha"]);
        assert.deepEqual(upstream.parts, []);

        await rig.pass(120 * SECOND);
        assert.equal(rig.status().channels, 1);
        assert.equal(rig.status().idleChannels, 0);
    });

    it("leaves nothing behind once the last overlay has been gone for a minute", async () => {
        const rig = new Rig();
        const alpha = await rig.joinLive("alpha");
        const beta = await rig.joinLive("beta");
        const upstream = rig.twitch.last;
        await rig.leave(alpha);
        rig.clock.advance(20 * SECOND);
        await rig.leave(beta);

        await rig.pass(50 * SECOND);
        assert.deepEqual(upstream.parts, ["alpha"]);
        assert.equal(rig.status().channels, 1);
        assert.notEqual(rig.host.alarmAt, null);

        await rig.pass(10 * SECOND);
        assert.deepEqual(upstream.parts, ["alpha", "beta"]);
        // No alarm, no timer, no connection: the runtime may remove the object.
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.clock.timers, 0);
        assert.equal(rig.twitch.open.length, 0);
        const status = rig.status();
        assert.equal(status.channels, 0);
        assert.equal(status.clients, 0);
        assert.equal(status.alarmInMs, null);
        assert.deepEqual(status.upstream.connections, []);

        await rig.pass(600 * SECOND);
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.twitch.sockets.length, 1);
    });

    it("sets no alarm and opens no connection for a status request", () => {
        const rig = new Rig();
        const status = rig.status();
        assert.equal(status.clients, 0);
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.clock.timers, 0);
        assert.equal(rig.twitch.sockets.length, 0);
    });

    it("runs its alarm every thirty seconds while overlays are connected", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        const times: number[] = [];
        for (let index = 0; index < 4; index++) {
            await rig.alarm();
            times.push(rig.clock.now);
        }
        const gaps = times.slice(1).map((at, index) => at - (times[index] as number));
        assert.deepEqual(gaps, [30 * SECOND, 30 * SECOND, 30 * SECOND]);
        assert.equal(rig.host.ticks.length, 4);
    });

    it("reports counters with every alarm", async () => {
        const rig = new Rig({ maxClients: 2 });
        await rig.joinLive("alpha");
        await rig.joinLive("beta");
        rig.core.refusal("gamma");
        for (const id of ["m-1", "m-2"]) rig.twitch.last.receive(chatLine("alpha", { id }));
        await rig.alarm();
        rig.twitch.last.receive(chatLine("alpha", { id: "m-3" }));
        await rig.alarm();
        assert.deepEqual(rig.host.ticks, [
            {
                clients: 2,
                channels: 2,
                upstreamConnections: 1,
                joinedChannels: 2,
                lines: 2,
                accepted: 2,
                refused: 1,
                upstreamFailures: 0,
            },
            {
                clients: 2,
                channels: 2,
                upstreamConnections: 1,
                joinedChannels: 2,
                lines: 1,
                accepted: 0,
                refused: 0,
                upstreamFailures: 0,
            },
        ]);
    });

    it("lets the runtime repeat an alarm that could not be set again", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        rig.host.storageDown = true;
        await assert.rejects(rig.alarm());
        rig.host.storageDown = false;
        await rig.core.alarm();
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);
    });

    it("serves overlays while the alarm cannot be set, and sets it with the next line", async () => {
        const rig = new Rig();
        rig.host.storageDown = true;
        const socket = await rig.joinLive("alpha");
        assert.deepEqual(socket.frames, [joinEcho("justinfan777", "alpha")]);
        assert.equal(rig.host.alarmAt, null);
        assert.ok((rig.status().counters["alarm-set-failed"] ?? 0) >= 1);

        rig.host.storageDown = false;
        rig.twitch.last.receive(chatLine("alpha", { id: "m-1" }));
        await Promise.resolve();
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);
        assert.equal(rig.status().counters["watchdog-rearmed"], 1);
    });

    it("sets a missed alarm again with the next line", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        // The alarm is a minute overdue and the runtime has not run it.
        rig.clock.advance(90 * SECOND);
        rig.host.alarmAt = null;
        rig.twitch.last.receive(chatLine("alpha", { id: "m-1" }));
        await Promise.resolve();
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);
    });
});

describe("hub restore", () => {
    it("takes up its overlays again after it was built anew", async () => {
        const rig = new Rig();
        const live = await rig.joinLive("alpha", "justinfan1");
        const waiting = await rig.join("beta", "justinfan2");
        const undecided = await rig.connect("gamma");
        const instance = rig.status().instance;
        const alarmAt = rig.host.alarmAt;
        live.frames.length = 0;

        await rig.rebuild();
        const status = rig.status();
        assert.notEqual(status.instance, instance);
        assert.equal(status.clients, 3);
        assert.equal(status.pendingClients, 1);
        assert.equal(status.channels, 2);
        assert.equal(status.counters.restored, 1);
        // The alarm that was set stays where it was.
        assert.equal(rig.host.alarmAt, alarmAt);

        const upstream = rig.twitch.last;
        upstream.login();
        assert.deepEqual(upstream.joins.sort(), ["alpha", "beta"]);
        upstream.confirmJoins();

        // Greeted before: chat goes on. Not greeted before: greeted now, with its own nick.
        assert.deepEqual(live.frames, []);
        assert.deepEqual(waiting.frames, [joinEcho("justinfan2", "beta")]);
        const line = chatLine("alpha", { id: "m-1" });
        upstream.receive(line);
        assert.deepEqual(live.frames, [line]);

        await rig.core.message(undecided, "JOIN #gamma");
        upstream.confirmJoins();
        assert.deepEqual(undecided.frames, [joinEcho("justinfan12345", "gamma")]);

        await rig.leave(live);
        assert.equal(rig.status().idleChannels, 1);
    });

    it("sets the alarm when none is left", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        rig.host.alarmAt = null;
        await rig.rebuild();
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);
    });

    it("closes a socket whose attachment it cannot read", async () => {
        const rig = new Rig();
        const live = await rig.joinLive("alpha");
        const broken = [null, "text", { channel: "alpha" }, { channel: "Not A Channel" }].map(
            (attachment) => {
                const socket = new FakeClientSocket();
                socket.attachment = attachment;
                rig.host.accepted.push(socket);
                return socket;
            },
        );
        await rig.rebuild();
        for (const socket of broken) assert.equal(socket.closeCode, 1011);
        assert.equal(live.closeCode, undefined);
        assert.equal(rig.status().clients, 1);
    });

    it("stays idle when there is nothing to take up", async () => {
        const rig = new Rig();
        await rig.rebuild();
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.clock.timers, 0);
        assert.equal(rig.twitch.sockets.length, 0);
        assert.equal(rig.status().counters.restored, undefined);
    });

    it("survives a storage that cannot be asked for the alarm", async () => {
        const rig = new Rig();
        await rig.joinLive("alpha");
        rig.host.storageDown = true;
        await rig.rebuild();
        assert.equal(rig.status().clients, 1);
        assert.equal(rig.status().counters["alarm-set-failed"], 1);
    });
});

describe("hub pause", () => {
    const PAUSED = { code: 1013, reason: "relay paused" };

    function closing(socket: FakeClientSocket) {
        return { code: socket.closeCode, reason: socket.closeReason };
    }

    /** A hub that one overlay too many has just paused. */
    async function paused(): Promise<Rig> {
        const rig = new Rig({ pauseClients: 1 });
        await rig.connect("alpha");
        await rig.connect("alpha");
        assert.equal(rig.host.pauses.length, 1);
        return rig;
    }

    /** Lets what the hub started without waiting for it come to its end. */
    const settled = () => new Promise((resolve) => setImmediate(resolve));

    it("pauses itself above its threshold of overlays, and not at it", async () => {
        const rig = new Rig({ pauseClients: 2 });
        const first = await rig.joinLive("alpha");
        const second = await rig.join("beta");
        await rig.alarm();
        assert.equal(rig.status().pause, null);
        assert.deepEqual(rig.host.pauses, []);

        const third = await rig.connect("alpha");
        for (const socket of [first, second, third]) assert.deepEqual(closing(socket), PAUSED);
        assert.deepEqual(rig.host.pauses, [{ reason: "clients", measured: 3, threshold: 2 }]);
        assert.equal(rig.status().counters["paused-clients"], 1);
    });

    it("pauses itself above its threshold of channels, and not at it", async () => {
        const rig = new Rig({ pauseChannels: 2 });
        const alpha = await rig.joinLive("alpha");
        await rig.joinLive("beta");
        await rig.alarm();
        assert.deepEqual(rig.host.pauses, []);

        // A channel that waits for its overlays to come back is a channel like any other.
        await rig.leave(alpha);
        const gamma = await rig.joinLive("gamma");
        assert.equal(gamma.closeCode, undefined);
        await rig.alarm();
        assert.deepEqual(closing(gamma), PAUSED);
        assert.deepEqual(rig.host.pauses, [{ reason: "channels", measured: 3, threshold: 2 }]);
        assert.equal(rig.status().counters["paused-channels"], 1);
        assert.equal(rig.host.alarmAt, null);
    });

    it("notices a channel too many with the next overlay that connects", async () => {
        const rig = new Rig({ pauseChannels: 2 });
        for (const channel of ["alpha", "beta", "gamma"]) await rig.joinLive(channel);
        assert.deepEqual(rig.host.pauses, []);
        const next = await rig.connect("alpha");
        assert.deepEqual(closing(next), PAUSED);
        assert.deepEqual(rig.host.pauses, [{ reason: "channels", measured: 3, threshold: 2 }]);
    });

    it("pauses itself above its threshold of connections within a minute", async () => {
        const rig = new Rig({ pauseConnectsPerMinute: 3 });
        const comeAndGo = async () => {
            const socket = await rig.connect("alpha");
            rig.clock.advance(SECOND);
            await rig.leave(socket);
            return socket;
        };
        for (let index = 0; index < 3; index++) await comeAndGo();
        // A minute later these are forgotten.
        rig.clock.advance(60 * SECOND);
        for (let index = 0; index < 3; index++) await comeAndGo();
        assert.deepEqual(rig.host.pauses, []);
        assert.equal(rig.status().clients, 0);

        const last = await rig.connect("alpha");
        assert.deepEqual(closing(last), PAUSED);
        assert.deepEqual(rig.host.pauses, [{ reason: "connects", measured: 4, threshold: 3 }]);
        assert.equal(rig.status().counters["paused-connects"], 1);
    });

    it("pauses itself above its threshold of chat lines within a minute", async () => {
        const rig = new Rig({ pauseLinesPerMinute: 5, watchdogMs: 10 * SECOND });
        const socket = await rig.joinLive("alpha");
        let sent = 0;
        const say = (count: number) => {
            for (let index = 0; index < count; index++) {
                rig.twitch.last.receive(chatLine("alpha", { id: `m-${++sent}` }));
            }
        };
        say(5);
        await rig.alarm();
        assert.deepEqual(rig.host.pauses, []);

        // Chat is counted line by line and looked at by the alarm.
        say(1);
        assert.equal(socket.closeCode, undefined);
        assert.equal(socket.frames.length, 7);
        await rig.alarm();
        assert.deepEqual(closing(socket), PAUSED);
        assert.deepEqual(rig.host.pauses, [{ reason: "lines", measured: 6, threshold: 5 }]);
        assert.equal(rig.status().counters["paused-lines"], 1);
        assert.equal(rig.host.alarmAt, null);
    });

    it("forgets the chat lines of more than a minute ago", async () => {
        const rig = new Rig({ pauseLinesPerMinute: 5 });
        await rig.joinLive("alpha");
        for (let minute = 0; minute < 5; minute++) {
            for (let index = 0; index < 5; index++) {
                rig.twitch.last.receive(chatLine("alpha", { id: `m-${minute}-${index}` }));
            }
            await rig.pass(60 * SECOND);
        }
        assert.deepEqual(rig.host.pauses, []);
        assert.equal(rig.status().counters["upstream-line"], 25);
    });

    it("leaves a threshold alone that is set to 0", async () => {
        const rig = new Rig({
            pauseClients: 0,
            pauseChannels: 0,
            pauseConnectsPerMinute: 0,
            pauseLinesPerMinute: 0,
        });
        const alpha = await rig.joinLive("alpha");
        const beta = await rig.joinLive("beta");
        rig.twitch.last.receive(chatLine("alpha", { id: "m-1" }));
        await rig.alarm();
        assert.deepEqual(rig.host.pauses, []);
        assert.equal(rig.status().pause, null);
        assert.equal(alpha.closeCode, undefined);
        assert.equal(beta.closeCode, undefined);
    });

    it("takes the wave of overlays that connect again after a deployment", async () => {
        const rig = new Rig();
        const { pauseClients, pauseConnectsPerMinute } = HUB_DEFAULTS;
        assert.ok(pauseConnectsPerMinute > pauseClients);
        for (let index = 0; index < pauseClients; index++) {
            await rig.join(`channel${index % 200}`);
            rig.clock.advance(2);
        }
        await rig.alarm();
        assert.equal(rig.status().clients, pauseClients);
        assert.equal(rig.status().channels, 200);
        assert.deepEqual(rig.host.pauses, []);

        await rig.connect("channel0");
        assert.deepEqual(rig.host.pauses, [
            { reason: "clients", measured: pauseClients + 1, threshold: pauseClients },
        ]);
    });

    it("closes every overlay, leaves Twitch and keeps nothing running", async () => {
        const rig = new Rig({ pauseClients: 3 });
        const live = await rig.joinLive("alpha");
        const waiting = await rig.join("beta");
        const undecided = await rig.connect("gamma");
        const upstream = rig.twitch.last;
        assert.equal(rig.twitch.open.length, 1);
        assert.equal(rig.clock.timers, 1);

        const last = await rig.connect("alpha");
        for (const socket of [live, waiting, undecided, last]) {
            assert.deepEqual(closing(socket), PAUSED);
        }
        assert.equal(upstream.closed, true);
        assert.equal(rig.twitch.open.length, 0);
        assert.equal(rig.clock.timers, 0);
        const status = rig.status();
        assert.equal(status.sockets, 0);
        assert.equal(status.clients, 0);
        assert.equal(status.channels, 0);
        assert.equal(status.replayLines, 0);
        assert.equal(status.upstream.wanted, 0);
        assert.deepEqual(status.upstream.connections, []);

        // The alarm that was set before the pause finds nothing to do and is the last one.
        await rig.alarm();
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.status().alarmInMs, null);
        assert.deepEqual(rig.host.ticks, []);

        // Neither what is still on its way to the hub nor the time wakes it up.
        upstream.receive(chatLine("alpha", { id: "m-1" }));
        await rig.core.message(live, "PING :late");
        for (const socket of [live, waiting, undecided, last]) await rig.core.closed(socket);
        await rig.pass(10 * MINUTE);
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.clock.timers, 0);
        assert.equal(rig.twitch.sockets.length, 1);
        assert.deepEqual(live.frames, [joinEcho("justinfan777", "alpha")]);
        assert.deepEqual(closing(live), PAUSED);
    });

    it("pauses itself above its threshold of frames within a minute, whoever sends them", async () => {
        const rig = new Rig({ pauseFramesPerMinute: 10 });
        const socket = await rig.joinLive("alpha");
        const quiet = await rig.joinLive("beta");
        // Six frames of two logins so far. The socket keeps talking after its close.
        await rig.core.message(socket, "PART #alpha");
        assert.equal(socket.closeCode, 1000);
        for (let index = 0; index < 3; index++) await rig.core.message(socket, "PING :x");
        assert.deepEqual(rig.host.pauses, []);
        await rig.core.message(socket, "PING :x");
        assert.deepEqual(rig.host.pauses, [{ reason: "frames", measured: 11, threshold: 10 }]);
        assert.deepEqual(closing(quiet), PAUSED);
        assert.equal(rig.status().counters["paused-frames"], 1);
    });

    it("resets itself when a socket it closed keeps talking during the pause", async () => {
        const rig = await paused();
        const [deaf] = rig.host.accepted;
        assert.deepEqual(closing(deaf as FakeClientSocket), PAUSED);
        assert.equal(rig.host.resets, 0);
        // The fake keeps returning the socket, as the runtime does until the close is answered.
        (deaf as FakeClientSocket).closeCode = undefined;
        await rig.core.message(deaf as FakeClientSocket, "PING :x");
        assert.equal(rig.host.resets, 1);
        assert.equal(rig.core.refusal("alpha"), "relay_paused");
        // Open again, a frame is a frame.
        rig.clock.advance(15 * MINUTE);
        const back = await rig.joinLive("alpha");
        assert.equal(back.closeCode, undefined);
        assert.equal(rig.host.resets, 1);
    });

    it("refuses overlays while it is paused and tells them how long that will be", async () => {
        const rig = await paused();
        assert.equal(rig.core.refusal("alpha"), "relay_paused");
        assert.equal(rig.core.retryAfter(), 900);
        rig.clock.advance(10 * SECOND + 1);
        assert.equal(rig.core.retryAfter(), 890);
        rig.clock.advance(889 * SECOND);
        assert.equal(rig.core.refusal("beta"), "relay_paused");
        assert.equal(rig.core.retryAfter(), 1);
        assert.equal(rig.status().counters["refused-paused"], 2);
        assert.equal(rig.twitch.sockets.length, 0);
    });

    it("tells its thresholds and its pause in the status", async () => {
        const rig = new Rig({ pauseClients: 1 });
        assert.equal(rig.status().pause, null);
        assert.deepEqual(rig.status().thresholds, {
            clients: 1,
            channels: 500,
            connectsPerMinute: 3000,
            linesPerMinute: 300_000,
            framesPerMinute: 10_000,
            pauseMs: 15 * MINUTE,
        });
        await rig.connect("alpha");
        await rig.connect("alpha");
        assert.deepEqual(rig.status().pause, { reason: "clients", remainingMs: 15 * MINUTE });
        rig.clock.advance(MINUTE);
        assert.deepEqual(rig.status().pause, { reason: "clients", remainingMs: 14 * MINUTE });
    });

    it("opens again by itself when the pause is over", async () => {
        const rig = await paused();
        assert.deepEqual(rig.host.stored, {
            until: rig.clock.now + 15 * MINUTE,
            reason: "clients",
        });
        rig.clock.advance(15 * MINUTE - 1);
        assert.equal(rig.core.refusal("alpha"), "relay_paused");
        assert.deepEqual(rig.host.resumes, []);

        rig.clock.advance(1);
        assert.equal(rig.core.refusal("alpha"), undefined);
        assert.equal(rig.core.retryAfter(), 30);
        assert.equal(rig.status().pause, null);
        assert.deepEqual(rig.host.resumes, ["clients"]);
        assert.deepEqual(rig.host.stored, {});

        const socket = await rig.joinLive("alpha");
        const line = chatLine("alpha", { id: "m-1" });
        rig.twitch.last.receive(line);
        assert.deepEqual(socket.frames, [joinEcho("justinfan777", "alpha"), line]);
        assert.equal(rig.host.alarmAt, rig.clock.now + 30 * SECOND);
        assert.equal(rig.host.pauses.length, 1);
        assert.equal(rig.status().counters.resumed, 1);
    });

    it("pauses again when the flood is still there", async () => {
        const rig = await paused();
        rig.clock.advance(15 * MINUTE);
        await rig.connect("alpha");
        assert.equal(rig.status().pause, null);
        const second = await rig.connect("alpha");
        assert.deepEqual(closing(second), PAUSED);
        assert.deepEqual(rig.host.resumes, ["clients"]);
        assert.equal(rig.host.pauses.length, 2);
        assert.deepEqual(rig.host.stored, {
            until: rig.clock.now + 15 * MINUTE,
            reason: "clients",
        });
    });

    it("stays paused when it is built again inside its pause", async () => {
        const rig = await paused();
        // The alarm that was set before the pause, half a minute into it.
        await rig.alarm();
        rig.clock.advance(5 * MINUTE - 30 * SECOND);
        // Whatever the runtime still holds is not taken up again.
        const held = new FakeClientSocket();
        held.attachment = {
            channel: "alpha",
            nick: "justinfan12345",
            phase: "live",
            since: rig.clock.now,
        };
        rig.host.accepted.push(held);

        await rig.rebuild();
        assert.deepEqual(closing(held), PAUSED);
        assert.deepEqual(rig.status().pause, { reason: "clients", remainingMs: 10 * MINUTE });
        assert.equal(rig.core.refusal("alpha"), "relay_paused");
        assert.equal(rig.core.retryAfter(), 600);
        assert.equal(rig.status().clients, 0);
        assert.equal(rig.status().channels, 0);
        assert.equal(rig.host.alarmAt, null);
        assert.equal(rig.clock.timers, 0);
        assert.equal(rig.twitch.sockets.length, 0);
        // The pause began once.
        assert.equal(rig.host.pauses.length, 1);

        rig.clock.advance(10 * MINUTE);
        assert.equal(rig.core.refusal("alpha"), undefined);
        assert.deepEqual(rig.host.resumes, ["clients"]);
        assert.deepEqual(rig.host.stored, {});
    });

    it("is open when it is built again after its pause, and keeps nothing of it", async () => {
        const rig = await paused();
        rig.clock.advance(15 * MINUTE);
        await rig.rebuild();
        assert.equal(rig.status().pause, null);
        assert.equal(rig.core.refusal("alpha"), undefined);
        assert.deepEqual(rig.host.resumes, ["clients"]);
        assert.deepEqual(rig.host.stored, {});

        const socket = await rig.joinLive("alpha");
        assert.deepEqual(socket.frames, [joinEcho("justinfan777", "alpha")]);
    });

    it("shortens a stored pause to the length a pause has now", async () => {
        const rig = new Rig();
        rig.host.stored = { until: rig.clock.now + 60 * MINUTE, reason: "lines" };
        await rig.rebuild();
        assert.deepEqual(rig.status().pause, { reason: "lines", remainingMs: 15 * MINUTE });
        assert.deepEqual(rig.host.stored, { until: rig.clock.now + 15 * MINUTE, reason: "lines" });
        assert.deepEqual(rig.host.resumes, []);

        rig.clock.advance(15 * MINUTE);
        assert.equal(rig.core.refusal("alpha"), undefined);
        assert.deepEqual(rig.host.resumes, ["lines"]);
        assert.deepEqual(rig.host.stored, {});
    });

    it("does not take up again a socket it closed whose other side never answered", async () => {
        const rig = await paused();
        const [deaf] = rig.host.accepted;
        assert.deepEqual(closing(deaf as FakeClientSocket), PAUSED);
        // The runtime keeps the socket until the close is answered.
        (deaf as FakeClientSocket).closeCode = undefined;
        rig.clock.advance(15 * MINUTE);
        await rig.rebuild();
        assert.equal(rig.status().pause, null);
        assert.equal(rig.status().clients, 0);
        assert.equal(rig.status().channels, 0);
        assert.equal(rig.twitch.sockets.length, 0);
        assert.equal(rig.status().counters["client-phantom"], 1);
        assert.equal(rig.status().counters.restored, undefined);
    });

    it("is open when its storage holds something that is not a pause", async () => {
        const later = new FakeClock().now + MINUTE;
        const broken = [
            { until: "soon", reason: "clients" },
            { until: later, reason: "alpha" },
            { until: later },
            { reason: "lines" },
        ];
        for (const stored of broken) {
            const rig = new Rig();
            rig.host.stored = stored;
            await rig.rebuild();
            assert.equal(rig.status().pause, null, JSON.stringify(stored));
            assert.equal(rig.core.refusal("alpha"), undefined);
            assert.deepEqual(rig.host.stored, {});
            assert.deepEqual(rig.host.resumes, []);
        }
    });

    it("pauses and opens all the same when its storage fails", async () => {
        const rig = new Rig({ pauseClients: 1 });
        await rig.connect("alpha");
        rig.host.storageDown = true;
        const second = await rig.connect("alpha");
        assert.deepEqual(closing(second), PAUSED);
        assert.equal(rig.core.refusal("alpha"), "relay_paused");
        assert.equal(rig.status().counters["pause-storage-failed"], 1);

        rig.clock.advance(15 * MINUTE);
        assert.equal(rig.core.refusal("alpha"), undefined);
        await settled();
        assert.equal(rig.status().counters["pause-storage-failed"], 2);
        assert.deepEqual(rig.host.resumes, ["clients"]);
    });
});

describe("hub privacy", () => {
    const secrets = ["alpha", "beta", "justinfan", "viewer", "synthetic", "m-1"];

    async function busy(): Promise<Rig> {
        const rig = new Rig({ maxClients: 3 });
        await rig.joinLive("alpha", "justinfan31337");
        const beta = await rig.joinLive("beta");
        const wrong = await rig.connect("alpha");
        await rig.core.message(wrong, "JOIN #beta");
        rig.core.refusal("alpha");
        rig.twitch.last.receive(roomstate("alpha"), chatLine("alpha", { id: "m-1" }));
        await rig.core.message(beta, "x".repeat(2000));
        await rig.alarm();
        rig.twitch.last.drop();
        await rig.alarm();
        return rig;
    }

    it("reports counts and nothing that names a channel, a user or a message", async () => {
        const rig = await busy();
        const text = JSON.stringify([rig.status(), rig.host.ticks]);
        for (const secret of secrets) assert.equal(text.includes(secret), false, secret);
        assert.equal(rig.status().clients, 1);
        assert.equal(rig.status().counters["upstream-line"], 2);
    });

    it("writes nothing to the log", async (t) => {
        const written: unknown[][] = [];
        for (const method of ["log", "info", "warn", "error", "debug"] as const) {
            t.mock.method(console, method, (...values: unknown[]) => {
                written.push(values);
            });
        }
        await busy();
        assert.deepEqual(written, []);
    });

    it("names no channel, no user and no message when it pauses itself", async (t) => {
        const written: unknown[][] = [];
        for (const method of ["log", "info", "warn", "error", "debug"] as const) {
            t.mock.method(console, method, (...values: unknown[]) => {
                written.push(values);
            });
        }
        const rig = new Rig({ pauseClients: 2, pauseMs: MINUTE });
        await rig.joinLive("alpha", "justinfan31337");
        await rig.joinLive("beta");
        rig.twitch.last.receive(roomstate("alpha"), chatLine("alpha", { id: "m-1" }));
        await rig.alarm();
        await rig.connect("alpha");
        rig.core.refusal("alpha");
        const during = [rig.status(), rig.host.stored];
        rig.clock.advance(MINUTE);
        rig.core.refusal("beta");

        const { host } = rig;
        assert.equal(host.pauses.length, 1);
        assert.equal(host.resumes.length, 1);
        const text = JSON.stringify([during, rig.status(), host.ticks, host.pauses, host.resumes]);
        for (const secret of secrets) assert.equal(text.includes(secret), false, secret);
        // The line in the log is the Durable Object's, which knows its shard.
        assert.deepEqual(written, []);
    });
});

/** The part of the Durable Object state that the hub uses. */
class FakeState {
    readonly id: { name?: string };
    readonly sockets: FakeClientSocket[] = [];
    autoResponse: { request: string; response: string } | undefined;
    alarmAt: number | null = null;
    restored: Promise<unknown> | undefined;
    /** What the storage holds besides the alarm. */
    readonly stored = new Map<string, unknown>();

    readonly storage = {
        getAlarm: async () => this.alarmAt,
        setAlarm: async (at: number) => {
            this.alarmAt = at;
        },
        get: async (keys: string[]) =>
            new Map([...this.stored].filter(([key]) => keys.includes(key))),
        put: async (entries: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(entries)) this.stored.set(key, value);
        },
        delete: async (keys: string[]) => keys.filter((key) => this.stored.delete(key)).length,
    };

    constructor(name?: string) {
        this.id = { name };
    }

    getWebSockets(): FakeClientSocket[] {
        return this.sockets;
    }

    getWebSocketAutoResponseTimestamp(): Date | null {
        return null;
    }

    setWebSocketAutoResponse(pair: { request: string; response: string }): void {
        this.autoResponse = pair;
    }

    blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
        const done = work();
        this.restored = done;
        return done;
    }
}

class FakeAutoResponse {
    readonly request: string;
    readonly response: string;

    constructor(request: string, response: string) {
        this.request = request;
        this.response = response;
    }
}

// Part of the Workers runtime, used by the hub's constructor.
Object.assign(globalThis, { WebSocketRequestResponsePair: FakeAutoResponse });

function durableObject(env: HubEnv = {}, state = new FakeState("hub-3")) {
    const hub = new ChatHub(state as unknown as DurableObjectState, env);
    const get = (path: string, init?: RequestInit) =>
        hub.fetch(new Request(`https://hub${path}`, init));
    return { hub, state, get };
}

const UPGRADE = { headers: { upgrade: "websocket" } };

describe("ChatHub", () => {
    it("lets the runtime answer the keep-alive of the overlay", () => {
        const { state } = durableObject();
        assert.deepEqual(
            { ...state.autoResponse },
            {
                request: "PING :petal",
                response: ":tmi.twitch.tv PONG tmi.twitch.tv :petal",
            },
        );
    });

    it("reports its status as JSON that is never cached", async () => {
        const { get, state } = durableObject();
        const response = await get("/api/status?shard=2");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
        const status = (await response.json()) as HubStatus;
        assert.equal(status.shard, 2);
        assert.equal(status.clients, 0);
        assert.equal(status.channels, 0);
        assert.equal(status.alarmInMs, null);
        assert.deepEqual(status.limits, { clients: 5000, channels: 1000 });
        assert.deepEqual(status.upstream.connections, []);
        assert.equal(state.alarmAt, null);
    });

    it("knows its shard by its name until it is told", async () => {
        const named = durableObject({}, new FakeState("hub-3"));
        assert.equal(((await (await named.get("/api/status")).json()) as HubStatus).shard, 3);
        const unnamed = durableObject({}, new FakeState());
        assert.equal(((await (await unnamed.get("/api/status")).json()) as HubStatus).shard, null);
        const told = await unnamed.get("/api/status?shard=1");
        assert.equal(((await told.json()) as HubStatus).shard, 1);
    });

    it("refuses what is not an upgrade for a valid channel", async () => {
        const { get } = durableObject();
        const cases: [string, RequestInit | undefined, number, string][] = [
            ["/api/irc?channel=alpha", undefined, 426, "upgrade_required"],
            ["/api/irc", UPGRADE, 400, "invalid_channel"],
            ["/api/irc?channel=not%20valid", UPGRADE, 400, "invalid_channel"],
            ["/api/irc?channel=alpha", { ...UPGRADE, method: "POST" }, 405, "method_not_allowed"],
            ["/api/status", { method: "DELETE" }, 405, "method_not_allowed"],
            ["/api/other", undefined, 404, "not_found"],
            ["/status", undefined, 404, "not_found"],
        ];
        for (const [path, init, status, error] of cases) {
            const response = await get(path, init);
            assert.equal(response.status, status, path);
            assert.equal(response.headers.get("cache-control"), "no-store", path);
            assert.deepEqual(await response.json(), { error }, path);
        }
    });

    it("refuses the upgrade when it is full", async () => {
        const state = new FakeState("hub-0");
        for (let index = 0; index < 2; index++) {
            const socket = new FakeClientSocket();
            socket.attachment = {
                channel: "alpha",
                nick: "justinfan12345",
                phase: "new",
                since: Date.now(),
            };
            state.sockets.push(socket);
        }
        const { get } = durableObject({ MAX_CLIENTS_PER_HUB: "2" }, state);
        await state.restored;

        const response = await get("/api/irc?channel=alpha", UPGRADE);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { error: "hub_full" });
        const status = (await (await get("/api/status")).json()) as HubStatus;
        assert.equal(status.clients, 2);
        assert.equal(status.pendingClients, 2);
    });

    it("reads its limits from the environment and ignores what is not a number", async () => {
        const limits = async (env: HubEnv) => {
            const response = await durableObject(env).get("/api/status");
            return ((await response.json()) as HubStatus).limits;
        };
        assert.deepEqual(await limits({ MAX_CLIENTS_PER_HUB: "70", MAX_CHANNELS_PER_HUB: " 7 " }), {
            clients: 70,
            channels: 7,
        });
        for (const value of ["", "0", "-5", "1.5", "many", "1e3"]) {
            assert.deepEqual(
                await limits({ MAX_CLIENTS_PER_HUB: value, MAX_CHANNELS_PER_HUB: value }),
                { clients: 5000, channels: 1000 },
                JSON.stringify(value),
            );
        }
    });

    it("reads the safety switch from the environment and ignores what is not a number", async () => {
        const thresholds = async (env: HubEnv) => {
            const response = await durableObject(env).get("/api/status");
            return ((await response.json()) as HubStatus).thresholds;
        };
        const defaults = {
            clients: 2000,
            channels: 500,
            connectsPerMinute: 3000,
            linesPerMinute: 300_000,
            framesPerMinute: 10_000,
            pauseMs: 900_000,
        };
        const all = (value: string): HubEnv => ({
            RELAY_PAUSE_CLIENTS: value,
            RELAY_PAUSE_CHANNELS: value,
            RELAY_PAUSE_CONNECTS_PER_MINUTE: value,
            RELAY_PAUSE_LINES_PER_MINUTE: value,
            RELAY_PAUSE_FRAMES_PER_MINUTE: value,
            RELAY_PAUSE_MINUTES: value,
        });
        assert.deepEqual(await thresholds({}), defaults);
        assert.deepEqual(await thresholds(all(" 7 ")), {
            clients: 7,
            channels: 7,
            connectsPerMinute: 7,
            linesPerMinute: 7,
            framesPerMinute: 7,
            pauseMs: 420_000,
        });
        // 0 switches a threshold off. A pause has a length.
        assert.deepEqual(await thresholds(all("0")), {
            clients: 0,
            channels: 0,
            connectsPerMinute: 0,
            linesPerMinute: 0,
            framesPerMinute: 0,
            pauseMs: 900_000,
        });
        for (const value of ["", "-5", "1.5", "many", "1e3"]) {
            assert.deepEqual(await thresholds(all(value)), defaults, JSON.stringify(value));
        }
    });

    it("pauses itself, says so once and refuses the upgrade until the pause is over", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 1_790_000_000_000 });
        const warned = t.mock.method(console, "warn", () => {});
        const points: { indexes: string[]; blobs: string[]; doubles: number[] }[] = [];
        const state = new FakeState("hub-2");
        for (let index = 0; index < 3; index++) {
            const socket = new FakeClientSocket();
            socket.attachment = {
                channel: "alpha",
                nick: "justinfan12345",
                phase: "new",
                since: Date.now(),
            };
            state.sockets.push(socket);
        }
        const env = {
            RELAY_PAUSE_CLIENTS: "2",
            RELAY_PAUSE_MINUTES: "2",
            ANALYTICS: { writeDataPoint: (point: (typeof points)[number]) => points.push(point) },
        } as unknown as HubEnv;
        const { hub, get } = durableObject(env, state);
        await state.restored;
        const pauseRows = () => points.filter((point) => point.indexes[0] !== "hub-tick");

        // The runtime runs the alarm that was set for the overlays.
        state.alarmAt = null;
        await hub.alarm();
        for (const socket of state.sockets) {
            assert.equal(socket.closeCode, 1013);
            assert.equal(socket.closeReason, "relay paused");
        }
        assert.deepEqual(
            warned.mock.calls.map((call) => call.arguments),
            [["hub paused itself", { reason: "clients", measured: 3, threshold: 2, shard: 2 }]],
        );
        assert.deepEqual(pauseRows(), [
            { indexes: ["hub-paused"], blobs: ["hub-paused", "clients"], doubles: [2, 3, 2] },
        ]);
        assert.deepEqual(
            [...state.stored],
            [
                ["pause-until", Date.now() + 120_000],
                ["pause-reason", "clients"],
            ],
        );
        assert.equal(state.alarmAt, null);

        const refused = await get("/api/irc?channel=alpha", UPGRADE);
        assert.equal(refused.status, 503);
        assert.equal(refused.headers.get("cache-control"), "no-store");
        assert.equal(refused.headers.get("retry-after"), "120");
        assert.deepEqual(await refused.json(), { error: "relay_paused" });

        t.mock.timers.tick(90_500);
        const later = await get("/api/irc?channel=beta", UPGRADE);
        assert.equal(later.headers.get("retry-after"), "30");
        assert.deepEqual(await later.json(), { error: "relay_paused" });
        const during = (await (await get("/api/status")).json()) as HubStatus;
        assert.deepEqual(during.pause, { reason: "clients", remainingMs: 29_500 });
        assert.equal(during.counters["refused-paused"], 2);

        t.mock.timers.tick(29_500);
        const after = (await (await get("/api/status")).json()) as HubStatus;
        assert.equal(after.pause, null);
        assert.deepEqual([...state.stored], []);
        assert.deepEqual(pauseRows().slice(1), [
            { indexes: ["hub-resumed"], blobs: ["hub-resumed", "clients"], doubles: [2] },
        ]);
        assert.equal(warned.mock.callCount(), 1);
        assert.equal(JSON.stringify([warned.mock.calls, points, after]).includes("alpha"), false);
    });

    it("finds its pause in the storage when it is built", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 1_790_000_000_000 });
        const warned = t.mock.method(console, "warn", () => {});
        const state = new FakeState("hub-1");
        state.stored.set("pause-until", Date.now() + 60_000);
        state.stored.set("pause-reason", "lines");
        const { get } = durableObject({}, state);
        await state.restored;

        const refused = await get("/api/irc?channel=alpha", UPGRADE);
        assert.equal(refused.status, 503);
        assert.equal(refused.headers.get("retry-after"), "60");
        assert.deepEqual(await refused.json(), { error: "relay_paused" });
        const status = (await (await get("/api/status")).json()) as HubStatus;
        assert.deepEqual(status.pause, { reason: "lines", remainingMs: 60_000 });
        assert.equal(state.alarmAt, null);
        assert.equal(warned.mock.callCount(), 0);
    });
});
