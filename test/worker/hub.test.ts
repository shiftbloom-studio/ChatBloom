import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChatHub, type HubEnv, type HubStatus } from "../../src/worker/hub";
import { HUB_DEFAULTS, type HubConfig, HubCore } from "../../src/worker/relay/core";
import { UPSTREAM_DEFAULTS } from "../../src/worker/relay/upstream";
import { FakeClientSocket, FakeClock, FakeHost, FakeTwitch } from "./relay/fakes";
import { chatLine, clearMessage, joinEcho, roomstate } from "./relay/lines";

const SECOND = 1000;
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
});

/** The part of the Durable Object state that the hub uses. */
class FakeState {
    readonly id: { name?: string };
    readonly sockets: FakeClientSocket[] = [];
    autoResponse: { request: string; response: string } | undefined;
    alarmAt: number | null = null;
    restored: Promise<unknown> | undefined;

    readonly storage = {
        getAlarm: async () => this.alarmAt,
        setAlarm: async (at: number) => {
            this.alarmAt = at;
        },
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
});
