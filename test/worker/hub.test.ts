import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HUB_DEFAULTS, type HubConfig, HubCore } from "../../src/worker/relay/core";
import { UPSTREAM_DEFAULTS } from "../../src/worker/relay/upstream";
import { FakeTwitch } from "./relay/fakes";
import { chatLine, joinEcho } from "./relay/lines";

/** The hub's end of an overlay's socket, as the runtime hands it to the Durable Object. */
class FakeClientSocket {
    readonly frames: string[] = [];
    closeCode: number | undefined;
    /** Survives the object, like the attachment of a hibernatable socket. */
    attachment: unknown = null;
    send = (data: string) => this.frames.push(data);
    deserializeAttachment = () => structuredClone(this.attachment);

    close(code = 1005): void {
        this.closeCode ??= code;
    }

    serializeAttachment(value: unknown): void {
        this.attachment = structuredClone(value);
    }
}

/** A hub in the part of the runtime that the Durable Object gives it, with Twitch behind it. */
class Rig {
    readonly twitch = new FakeTwitch();
    /** Every socket the runtime accepted. */
    readonly accepted: FakeClientSocket[] = [];
    readonly config: HubConfig;
    core: HubCore<FakeClientSocket>;
    now = () => this.twitch.time;
    sockets = () => this.accepted.filter((socket) => socket.closeCode === undefined);
    keptAliveAt = () => undefined;
    getAlarm = async () => null;
    setAlarm = async () => {};
    report = () => {};

    constructor(overrides: Partial<HubConfig> = {}) {
        const upstream = { ...UPSTREAM_DEFAULTS, url: "wss://irc.example.test" };
        this.config = { ...HUB_DEFAULTS, upstream, ...overrides };
        this.core = new HubCore(this.config, this, this.twitch);
    }

    /** What the Worker's upgrade request leads to. */
    async connect(channel: string): Promise<FakeClientSocket> {
        const socket = new FakeClientSocket();
        this.accepted.push(socket);
        await this.core.accepted(socket, channel);
        return socket;
    }

    /** An overlay that connects and says what overlays say. Its frames start with the JOIN. */
    async join(channel: string, nick = "justinfan777"): Promise<FakeClientSocket> {
        const socket = await this.connect(channel);
        const hello = `CAP REQ :twitch.tv/tags twitch.tv/commands\r\nNICK ${nick}`;
        await this.core.message(socket, hello);
        socket.frames.length = 0;
        await this.core.message(socket, `JOIN #${channel}`);
        return socket;
    }

    /** An overlay on a channel that Twitch has confirmed. */
    async joinLive(channel: string, nick?: string): Promise<FakeClientSocket> {
        const socket = await this.join(channel, nick);
        if (this.twitch.last.nick === "") this.twitch.last.login();
        this.twitch.last.confirmJoins();
        return socket;
    }
}

describe("hub relay", () => {
    it("sends a channel's chat to its own overlays only, from the JOIN echo on", async () => {
        const rig = new Rig();
        const alpha = await rig.join("alpha");
        const upstream = rig.twitch.last;
        upstream.login();
        assert.deepEqual(alpha.frames, []);
        upstream.confirmJoins();
        assert.deepEqual(alpha.frames, [joinEcho("justinfan777", "alpha")]);

        const beta = await rig.joinLive("beta");
        const line = chatLine("alpha", "m-1");
        upstream.receive(line);
        assert.deepEqual(alpha.frames.slice(1), [line]);
        assert.deepEqual(beta.frames, [joinEcho("justinfan777", "beta")]);
    });

    it("greets a later overlay with the room state and the newest lines in one frame", async () => {
        const rig = new Rig({ replayLines: 2 });
        await rig.joinLive("alpha");
        const roomstate = "@room-id=1;slow=0 :tmi.twitch.tv ROOMSTATE #alpha";
        const lines = ["m-1", "m-2", "m-3"].map((id) => chatLine("alpha", id));
        rig.twitch.last.receive(roomstate, ...lines);
        const late = await rig.join("alpha", "justinfan888");
        assert.deepEqual(late.frames[0]?.split("\r\n"), [
            joinEcho("justinfan888", "alpha"),
            roomstate,
            ...lines.slice(1).map((line) => `@petal-replay=1;${line.slice(1)}`),
        ]);
        // Asked of Twitch once.
        assert.deepEqual(rig.twitch.last.channels(), ["alpha"]);
    });

    it("takes up its overlays again after it was built anew", async () => {
        const rig = new Rig();
        const live = await rig.joinLive("alpha", "justinfan1");
        const waiting = await rig.join("beta", "justinfan2");
        live.frames.length = 0;
        rig.core = new HubCore(rig.config, rig, rig.twitch);
        await rig.core.restore();

        const upstream = rig.twitch.last;
        upstream.login();
        upstream.confirmJoins();
        // Greeted before: chat goes on. Not greeted before: greeted now, with its own nick.
        assert.deepEqual(waiting.frames, [joinEcho("justinfan2", "beta")]);
        const line = chatLine("alpha", "m-1");
        upstream.receive(line);
        assert.deepEqual(live.frames, [line]);
    });
});

describe("hub admission", () => {
    it("closes an overlay that asks for another channel than it connected for", async () => {
        const rig = new Rig();
        for (const join of ["JOIN #beta", "JOIN #alpha,#beta"]) {
            const socket = await rig.connect("alpha");
            await rig.core.message(socket, join);
            assert.equal(socket.closeCode, 1008, join);
        }
        assert.equal(rig.core.status(0).channels, 0);
        assert.equal(rig.twitch.sockets.length, 0);
    });

    it("refuses overlays beyond its limit before the upgrade", async () => {
        const rig = new Rig({ maxClients: 2 });
        const first = await rig.join("alpha");
        await rig.connect("beta");
        assert.equal(rig.core.refusal("gamma"), "hub_full");
        first.close(1000);
        await rig.core.closed(first);
        assert.equal(rig.core.refusal("gamma"), undefined);
    });

    it("refuses channels beyond its limit and keeps serving the ones it has", async () => {
        const rig = new Rig({ maxChannels: 2 });
        await rig.joinLive("alpha");
        // Connected before the limit was reached, but not joined yet.
        const undecided = await rig.connect("gamma");
        await rig.joinLive("beta");

        assert.equal(rig.core.refusal("gamma"), "channels_full");
        assert.equal(rig.core.refusal("alpha"), undefined);
        assert.equal((await rig.join("alpha")).closeCode, undefined);
        await rig.core.message(undecided, "JOIN #gamma");
        assert.equal(undecided.closeCode, 1013);
        assert.deepEqual(rig.twitch.last.channels(), ["alpha", "beta"]);
    });
});
