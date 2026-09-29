import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import * as bttv from "../../../src/lib/chat/providers/bttv";
import * as chatterino from "../../../src/lib/chat/providers/chatterino";
import * as ffz from "../../../src/lib/chat/providers/ffz";
import * as sevenTV from "../../../src/lib/chat/providers/seventv/api";
import { V4_PAINT_FIELDS as CLIENT_PAINT_FIELDS } from "../../../src/lib/chat/providers/seventv/paint";
import * as twitch from "../../../src/lib/chat/providers/twitch";
import { type GatewayEvent, handleData } from "../../../src/worker/gateway/index";
import {
    PAINTS_PER_QUERY,
    PAINTS_PER_REQUEST,
    V4_PAINT_FIELDS,
} from "../../../src/worker/gateway/paints";
import { GATEWAY_ROUTES } from "../../../src/worker/gateway/routes";
import { jsonResponse } from "./fakes";

const ORIGIN = "https://chat.example";
const ROOM = "50985620";
/** A room no provider knows. */
const NOBODY = "50985621";
const SET = "01FKX5Q4VG0004X8QJ9S80KD58";
const paintId = (n: number) => `01FQB6K5T0000BDD0YMN2${String(n).padStart(5, "0")}`;

const file = (name: string, format: string) => ({
    name,
    static_name: name.replace(".", "_static."),
    width: 32,
    height: 32,
    frame_count: 1,
    size: 1024,
    format,
});

const sevenTVEmote = (id: string, name: string, flags: number) => ({
    id,
    name,
    flags,
    timestamp: 1614952484000,
    actor_id: null,
    data: {
        id,
        name: name.toLowerCase(),
        flags: 0,
        lifecycle: 3,
        listed: true,
        animated: false,
        owner: { id: "uploader", username: "uploader", roles: ["a", "b"] },
        host: {
            url: `//cdn.7tv.app/emote/${id}`,
            files: ["1x", "2x", "3x", "4x"].flatMap((size) => [
                file(`${size}.avif`, "AVIF"),
                file(`${size}.webp`, "WEBP"),
            ]),
        },
    },
});

const sevenTVSet = (id: string, flags: number) => ({
    id,
    name: "Emotes",
    flags,
    capacity: 1000,
    owner: { id: "owner", username: "somebody" },
    emotes: [
        sevenTVEmote("01F01APK500007E4VV006YKSMR", "Plain", 0),
        sevenTVEmote("01F5PFV1N80004R630K8ESP471", "Over", 1),
        { id: "01F5Y7JW30000ARAYB43QGQ4KV", name: "Gone", flags: 0, data: null },
    ],
});

const paint = (id: string) => ({
    id,
    name: `Paint ${id.slice(-2)}`,
    data: {
        layers: [
            {
                opacity: 1,
                ty: { __typename: "PaintLayerTypeSingleColor", color: { hex: "#ff00aa" } },
            },
            {
                opacity: 0.5,
                ty: {
                    __typename: "PaintLayerTypeLinearGradient",
                    angle: 90,
                    repeating: false,
                    stops: [
                        { at: 0, color: { hex: "#000000" } },
                        { at: 1, color: { hex: "#ffffff" } },
                    ],
                },
            },
        ],
        shadows: [{ color: { hex: "#000000" }, offsetX: 1, offsetY: 1, blur: 2 }],
    },
});

const twitchBadges = [
    {
        set_id: "subscriber",
        versions: [
            {
                id: "0",
                title: "Subscriber",
                description: "Subscriber",
                image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/a/1",
                image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/a/2",
                image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/a/3",
            },
        ],
    },
];

const ffzSet = {
    id: 3,
    title: "Global Emotes",
    emoticons: [
        {
            id: 28136,
            name: "LilZ",
            width: 32,
            height: 32,
            public: false,
            owner: { _id: 1, name: "somebody" },
            urls: { "1": "https://cdn.frankerfacez.com/emote/28136/1", "2": null, "4": null },
        },
    ],
};

/** What the providers hold, by the URL the client asks when there is no gateway. */
const PROVIDERS: Record<string, unknown> = {
    "https://7tv.io/v3/emote-sets/global": sevenTVSet("01HKQT8EWR000ESSWF3625XCS4", 0),
    [`https://7tv.io/v3/emote-sets/${SET}`]: sevenTVSet(SET, 4),
    [`https://7tv.io/v3/users/twitch/${ROOM}`]: {
        id: ROOM,
        platform: "TWITCH",
        username: "somebody",
        emote_set_id: SET,
        emote_set: sevenTVSet(SET, 0),
        user: { id: "01FKX5Q4VG0004X8QJ9S80KD59", username: "somebody", editors: [{ id: "e" }] },
    },
    "https://api.betterttv.net/3/cached/emotes/global": [
        { id: "54fa8f1401e468494b85b537", code: ":tf:", imageType: "png", animated: false },
        { id: "5e76d338d6581c3724c0f0b2", code: "cvHazmat", imageType: "png", animated: false },
    ],
    [`https://api.betterttv.net/3/cached/users/twitch/${ROOM}`]: {
        id: "55af0a6b0d87fd2766bee82b",
        bots: [],
        channelEmotes: [{ id: "a", code: "Mine", imageType: "gif", animated: true }],
        sharedEmotes: [{ id: "b", code: "Shared", imageType: "png", animated: false }],
    },
    "https://api.betterttv.net/3/cached/badges/twitch": [
        {
            id: "54ee2465b822020506c52a52",
            name: "night",
            providerId: "11785491",
            badge: { type: 1, description: "Developer", svg: "https://cdn.betterttv.net/dev.svg" },
        },
    ],
    "https://api.frankerfacez.com/v1/set/global": {
        default_sets: [3],
        sets: { "3": ffzSet },
        users: { "4330": ["somebody"] },
    },
    [`https://api.frankerfacez.com/v1/room/id/${ROOM}`]: {
        room: {
            _id: 291491,
            twitch_id: Number(ROOM),
            id: "somebody",
            set: 291493,
            mod_urls: { "1": "//cdn.frankerfacez.com/room-badge/mod/1", "2": null, "4": null },
            vip_badge: null,
            user_badge_ids: { "2": [1234, 5678] },
        },
        sets: { "291493": { ...ffzSet, id: 291493 } },
    },
    "https://api.frankerfacez.com/v1/badges/ids": {
        badges: [
            {
                id: 2,
                name: "bot",
                title: "Bot",
                slot: 1,
                replaces: "moderator",
                color: "#595959",
                urls: { "1": "//cdn.frankerfacez.com/badge/2/1", "2": null, "4": null },
            },
        ],
        users: { "2": [1234] },
    },
    "https://api.ffzap.com/v1/supporters": [
        { id: "4867723", badge_color: "#812FA8", badge_is_colored: 0, tier: 3 },
        { id: "11819690", tier: 2, badge_color: "#ffffff" },
        { id: "1", tier: 0 },
    ],
    "https://api.chatterino.com/badges": {
        badges: [
            {
                tooltip: "Chatterino Top Donator",
                image1: "https://fourtf.com/chatterino/badges/1.png",
                image2: "https://fourtf.com/chatterino/badges/2.png",
                image3: "https://fourtf.com/chatterino/badges/3.png",
                users: ["1234", "5678"],
            },
        ],
    },
    "https://api.ivr.fi/v2/twitch/badges/global": twitchBadges,
    [`https://api.ivr.fi/v2/twitch/badges/channel?id=${ROOM}`]: twitchBadges,
    [`https://api.ivr.fi/v2/twitch/badges/channel?id=${NOBODY}`]: [],
};

const KNOWN_PAINTS = new Set([paintId(1), paintId(2)]);

/** Answers like 7TV does, down to the queries it refuses. */
function paints(init: RequestInit | undefined): Response {
    const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
    const ids = Object.values(variables);
    if (ids.length > PAINTS_PER_QUERY) {
        return jsonResponse({ data: null, errors: [{ message: "Query is too complex." }] });
    }
    return jsonResponse({
        data: {
            paints: Object.fromEntries(
                ids.map((id, i) => [`p${i}`, KNOWN_PAINTS.has(id) ? paint(id) : null]),
            ),
        },
    });
}

/**
 * Puts the Worker's gateway and the providers behind fetch(): what goes to the overlay's own
 * origin is answered by `handleData`, which in turn asks the providers through the same fetch().
 */
function platform(t: TestContext) {
    const asked: string[] = [];
    const events: GatewayEvent[] = [];
    const context = {
        waitUntil: () => {},
        passThroughOnException: () => {},
    } as unknown as Parameters<typeof handleData>[2];
    t.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input instanceof Request ? input.url : input));
            if (url.origin === ORIGIN) {
                return handleData(new Request(url, init), {}, context, url, (event) =>
                    events.push(event),
                );
            }
            asked.push(url.href);
            if (url.href === "https://7tv.io/v4/gql") return paints(init);
            return url.href in PROVIDERS
                ? jsonResponse(PROVIDERS[url.href])
                : jsonResponse({ error: "Not Found" }, 404);
        },
    );
    t.mock.method(console, "warn", () => {});
    return { asked, events };
}

/** Pretends the overlay was loaded from the platform, which is what turns the gateway on. */
function onPlatform(t: TestContext): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
        value: new URL(`${ORIGIN}/chat/somebody`),
        configurable: true,
    });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, "location", original);
        else Reflect.deleteProperty(globalThis, "location");
    });
}

/** What the client passes to the requests that do not take the id of a Twitch room. */
const ARGUMENTS: Record<string, unknown[]> = {
    fetchSevenTVEmoteSet: [SET],
    fetchSevenTVPaints: [[paintId(2), paintId(3), paintId(1)]],
};

/** A 7TV set as the client reads it: the gateway drops the fields the client has no use for. */
const asRead = (set: sevenTV.SevenTVEmoteSet | undefined) =>
    set && { id: set.id, name: set.name, flags: set.flags, emotes: sevenTV.sevenTVEmotes(set) };

/**
 * Calls every request function of the client's providers. They are found by their name, so a
 * request added to the client is compared here as well, and fails until the gateway serves it.
 */
async function everything(room: string): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    for (const provider of [bttv, chatterino, ffz, sevenTV, twitch]) {
        for (const [name, request] of Object.entries(provider)) {
            if (!name.startsWith("fetch") || typeof request !== "function") continue;
            const ask = request as (...parameters: unknown[]) => Promise<unknown>;
            results[name] = await ask(...(ARGUMENTS[name] ?? [room]));
        }
    }
    const channel = results.fetchSevenTVChannel as sevenTV.SevenTVChannel | undefined;
    return {
        ...results,
        fetchSevenTVEmoteSet: asRead(results.fetchSevenTVEmoteSet as sevenTV.SevenTVEmoteSet),
        fetchSevenTVChannel: channel && { ...channel, emoteSet: asRead(channel.emoteSet) },
    };
}

describe("the client behind the gateway", () => {
    it("gets what the providers give it directly", async (t) => {
        const { asked, events } = platform(t);
        const direct = await everything(ROOM);
        assert.equal(events.length, 0);
        const directly = asked.splice(0);

        onPlatform(t);
        const relayed = await everything(ROOM);
        assert.deepEqual(relayed, direct);
        assert.ok(Object.keys(relayed).length >= GATEWAY_ROUTES.length);

        // The gateway asked the providers for what the client asks them itself, and nothing
        // went past it.
        assert.deepEqual(asked.toSorted(), directly.toSorted());
        assert.deepEqual(
            events.map((event) => [event.outcome, event.status]),
            events.map(() => ["MISS", 200]),
        );
        assert.deepEqual(
            events.map((event) => event.route).toSorted(),
            GATEWAY_ROUTES.map((route) => route.id).toSorted(),
        );
    });

    it("hears of a channel no provider knows, as it does directly", async (t) => {
        const { asked, events } = platform(t);
        const direct = await everything(NOBODY);
        assert.equal(direct.fetchSevenTVChannel, undefined);
        assert.equal(direct.fetchBTTVChannelEmotes, undefined);
        assert.equal(direct.fetchFFZRoom, undefined);
        asked.length = 0;

        onPlatform(t);
        assert.deepEqual(await everything(NOBODY), direct);
        const unknown = events.filter((event) => event.status === 404);
        assert.deepEqual(unknown.map((event) => event.route).toSorted(), [
            "7tv.user",
            "bttv.user",
            "ffz.room",
        ]);
        // Asked of the gateway and answered by it: none of the 404s sent the client on.
        assert.deepEqual(
            asked.filter((url) => url.includes(NOBODY)).toSorted(),
            [
                `https://7tv.io/v3/users/twitch/${NOBODY}`,
                `https://api.betterttv.net/3/cached/users/twitch/${NOBODY}`,
                `https://api.frankerfacez.com/v1/room/id/${NOBODY}`,
                `https://api.ivr.fi/v2/twitch/badges/channel?id=${NOBODY}`,
            ].toSorted(),
        );
    });

    it("gets more paints at once than 7TV gives it directly", async (t) => {
        const { asked } = platform(t);
        const ids = Array.from({ length: PAINTS_PER_REQUEST }, (_, i) => paintId(i + 100));
        for (const id of ids) KNOWN_PAINTS.add(id);
        t.after(() => {
            for (const id of ids) KNOWN_PAINTS.delete(id);
        });
        assert.deepEqual(await sevenTV.fetchSevenTVPaints(ids), []);
        asked.length = 0;

        onPlatform(t);
        const relayed = await sevenTV.fetchSevenTVPaints(ids);
        assert.deepEqual(
            relayed.map((each) => each.id),
            ids,
        );
        assert.equal(asked.length, Math.ceil(PAINTS_PER_REQUEST / PAINTS_PER_QUERY));
    });

    it("asks for paints with the selection the gateway asks 7TV for", () => {
        assert.equal(V4_PAINT_FIELDS, CLIENT_PAINT_FIELDS);
    });
});
