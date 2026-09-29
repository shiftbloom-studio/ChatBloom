import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { applyFfzFlags, FfzFlag, hasEffects, NO_EFFECTS } from "../../src/lib/chat/effects";
import {
    bttvUser,
    fetchBTTVBadges,
    fetchBTTVChannelEmotes,
    fetchBTTVGlobalEmotes,
} from "../../src/lib/chat/providers/bttv";
import { fetchChatterinoBadges } from "../../src/lib/chat/providers/chatterino";
import {
    fetchFFZAPBadges,
    fetchFFZBadges,
    fetchFFZGlobal,
    fetchFFZRoom,
} from "../../src/lib/chat/providers/ffz";
import { fetchSevenTVChannel } from "../../src/lib/chat/providers/seventv/api";
import {
    defaultColor,
    fetchTwitchChannelBadges,
    fetchTwitchGlobalBadges,
    readableColor,
    resolveTwitchBadges,
} from "../../src/lib/chat/providers/twitch";
import { stubFetch } from "../helpers";

let restoreFetch = () => {};
afterEach(() => restoreFetch());

const BTTV = "https://api.betterttv.net/3/cached";
const FFZ = "https://api.frankerfacez.com/v1";

describe("BTTV", () => {
    it("maps global emotes, flagging only known prefix modifiers", async () => {
        restoreFetch = stubFetch({
            [`${BTTV}/emotes/global`]: [
                { id: "a", code: "w!", modifier: true },
                { id: "b", code: "x!", modifier: true },
                { id: "c", code: "cvHazmat" },
            ],
        });
        const [wide, unknown, hazmat] = await fetchBTTVGlobalEmotes();
        assert.equal(wide.bttvModifier, true);
        assert.equal(unknown.bttvModifier, undefined);
        assert.equal(hazmat.zeroWidth, true);
        assert.deepEqual(hazmat.images, {
            1: "https://cdn.betterttv.net/emote/c/1x.webp",
            2: "https://cdn.betterttv.net/emote/c/2x.webp",
            4: "https://cdn.betterttv.net/emote/c/3x.webp",
        });
    });

    it("merges channel and shared emotes, and treats 404 as no account", async () => {
        restoreFetch = stubFetch({
            [`${BTTV}/users/twitch/1`]: {
                channelEmotes: [{ id: "a", code: "Mine" }],
                sharedEmotes: [{ id: "b", code: "Shared" }],
            },
            [`${BTTV}/users/twitch/2`]: 404,
        });
        assert.deepEqual(
            (await fetchBTTVChannelEmotes("1"))?.map((e) => e.name),
            ["Mine", "Shared"],
        );
        assert.equal(await fetchBTTVChannelEmotes("2"), undefined);
    });

    it("keys badges by Twitch user id", async () => {
        restoreFetch = stubFetch({
            [`${BTTV}/badges/twitch`]: [
                {
                    providerId: "100000004",
                    badge: { description: "NightDev Developer", svg: "https://cdn/dev.svg" },
                },
            ],
        });
        const badge = (await fetchBTTVBadges()).get("100000004");
        assert.equal(badge?.title, "NightDev Developer");
        assert.deepEqual(badge?.images, { 1: "https://cdn/dev.svg" });
    });

    it("falls back to the legacy glow flag and ignores emotes of non-Pro users", () => {
        const user = bttvUser({
            providerId: "1",
            pro: false,
            glow: true,
            emotes: [{ id: "a", code: "A" }],
        });
        assert.equal(user.effect, "glow");
        assert.deepEqual(user.emotes, []);
    });
});

describe("FFZ", () => {
    it("reads default sets, per-user sets, modifiers and animated images", async () => {
        restoreFetch = stubFetch({
            [`${FFZ}/set/global`]: {
                default_sets: [3],
                sets: {
                    3: {
                        id: 3,
                        emoticons: [
                            {
                                id: 1,
                                name: "ffzW",
                                width: 18,
                                height: 18,
                                modifier: true,
                                modifier_flags: 9,
                                urls: { 1: "//cdn.frankerfacez.com/emote/1/1" },
                            },
                        ],
                    },
                    1532818: {
                        id: 1532818,
                        emoticons: [
                            {
                                id: 2,
                                name: "Anim",
                                width: 28,
                                height: 28,
                                urls: { 1: "https://cdn/2/1", 2: "https://cdn/2/2" },
                                animated: { 1: "https://cdn/2/animated/1" },
                            },
                        ],
                    },
                },
                users: { 1532818: ["alice", "bob"] },
            },
        });
        const global = await fetchFFZGlobal();
        assert.deepEqual(global.defaultSets, ["3"]);
        assert.deepEqual(global.userSets.get("alice"), ["1532818"]);
        const [ffzW] = global.sets.get("3") ?? [];
        assert.equal(ffzW.ffzModifierFlags, FfzFlag.Hidden | FfzFlag.GrowX);
        assert.equal(ffzW.images[1], "https://cdn.frankerfacez.com/emote/1/1");
        const [anim] = global.sets.get("1532818") ?? [];
        assert.deepEqual(anim.images, { 1: "https://cdn/2/animated/1" });
        assert.equal(anim.ffzModifierFlags, undefined);
    });

    it("reads a room's custom badges and per-channel badge holders", async () => {
        restoreFetch = stubFetch({
            [`${FFZ}/room/id/1`]: {
                room: {
                    mod_urls: { 1: "https://cdn/mod/1", 2: "https://cdn/mod/2" },
                    vip_badge: null,
                    user_badge_ids: { 2: [123, 456] },
                },
                sets: { 99: { id: 99, emoticons: [] } },
            },
            [`${FFZ}/room/id/2`]: 404,
        });
        const room = await fetchFFZRoom("1");
        assert.equal(room?.moderatorBadge?.background, "#34ae0a");
        assert.equal(room?.vipBadge, undefined);
        assert.deepEqual(room?.userBadges.get("2"), ["123", "456"]);
        assert.deepEqual([...(room?.sets.keys() ?? [])], ["99"]);
        assert.equal(await fetchFFZRoom("2"), undefined);
    });

    it("maps global badges to their holders", async () => {
        restoreFetch = stubFetch({
            [`${FFZ}/badges/ids`]: {
                badges: [
                    {
                        id: 2,
                        title: "Bot",
                        color: "#595959",
                        replaces: "moderator",
                        urls: { 1: "https://cdn/b/1" },
                    },
                ],
                users: { 2: [42] },
            },
        });
        const { badges, users } = await fetchFFZBadges();
        assert.deepEqual(users.get("42"), ["2"]);
        assert.equal(badges.get("2")?.replaces, "moderator");
        assert.equal(badges.get("2")?.background, "#595959");
    });

    it("applies the FFZ:AP tier rules to badge colors", async () => {
        restoreFetch = stubFetch({
            "https://api.ffzap.com/v1/supporters": [
                { id: "1", tier: 1 },
                { id: "2", tier: 2, badge_color: "#812FA8" },
                { id: "3", tier: 3, badge_color: "#FFD700", badge_is_colored: 1 },
                { id: "4", tier: 0 },
            ],
        });
        const badges = await fetchFFZAPBadges();
        assert.equal(badges.get("1")?.background, "#755000");
        assert.equal(badges.get("2")?.background, "#812FA8");
        assert.equal(badges.get("3")?.background, undefined);
        assert.equal(badges.has("4"), false);
        assert.equal(badges.get("2")?.images[4], "https://api.ffzap.com/v1/user/badge/2/3");
    });

    it("stacks exclusive animations the way FFZ does", () => {
        const inOut = applyFfzFlags(NO_EFFECTS, FfzFlag.Appear | FfzFlag.Leave | FfzFlag.Rotate);
        assert.deepEqual(inOut.animations, ["cb-fx-in-out 6s linear infinite"]);
        const slide = applyFfzFlags(NO_EFFECTS, FfzFlag.Slide | FfzFlag.Rotate);
        assert.deepEqual([slide.slide, slide.animations], [true, []]);
        assert.equal(hasEffects(applyFfzFlags(NO_EFFECTS, FfzFlag.Hidden)), false);
    });
});

describe("7TV", () => {
    it("reads the channel's 7TV user and emote set, and treats 404 as no account", async () => {
        restoreFetch = stubFetch({
            "https://7tv.io/v3/users/twitch/1": {
                user: { id: "01FE9D" },
                emote_set: { id: "set", name: "xqc", flags: 0, emotes: [] },
            },
            "https://7tv.io/v3/users/twitch/2": 404,
        });
        const channel = await fetchSevenTVChannel("1");
        assert.equal(channel?.userId, "01FE9D");
        assert.equal(channel?.emoteSet?.id, "set");
        assert.equal(await fetchSevenTVChannel("2"), undefined);
    });
});

describe("Twitch and Chatterino", () => {
    const IVR = "https://api.ivr.fi/v2/twitch/badges";
    const version = (id: string, title: string) => ({
        id,
        title,
        image_url_1x: `https://cdn/${title}/1`,
        image_url_2x: `https://cdn/${title}/2`,
        image_url_4x: `https://cdn/${title}/3`,
    });

    it("prefers channel badges over global ones", async () => {
        restoreFetch = stubFetch({
            [`${IVR}/global`]: [
                { set_id: "subscriber", versions: [version("0", "Global Sub")] },
                { set_id: "moderator", versions: [version("1", "Moderator")] },
            ],
            [`${IVR}/channel?id=7`]: [
                { set_id: "subscriber", versions: [version("0", "Channel Sub")] },
            ],
        });
        const global = await fetchTwitchGlobalBadges();
        const channel = await fetchTwitchChannelBadges("7");
        const badges = resolveTwitchBadges(
            [
                { set: "moderator", version: "1" },
                { set: "subscriber", version: "0" },
                { set: "unknown", version: "1" },
            ],
            channel,
            global,
        );
        assert.deepEqual(
            badges.map((b) => b.title),
            ["Moderator", "Channel Sub"],
        );
        assert.equal(badges[0].images[4], "https://cdn/Moderator/3");
    });

    it("assigns stable default colors and lifts unreadably dark ones", () => {
        assert.equal(defaultColor("forsen"), defaultColor("forsen"));
        assert.match(defaultColor("forsen"), /^#[0-9A-F]{6}$/);
        assert.equal(readableColor("#FF4500"), "#FF4500");
        assert.notEqual(readableColor("#0000FF"), "#0000FF");
        assert.equal(readableColor("not a color"), "not a color");
    });

    it("maps Chatterino badges to each listed user", async () => {
        restoreFetch = stubFetch({
            "https://api.chatterino.com/badges": {
                badges: [
                    {
                        tooltip: "Chatterino Top Donator",
                        image1: "https://fourtf.com/1.png",
                        image2: "https://fourtf.com/2.png",
                        image3: "https://fourtf.com/3.png",
                        users: ["100000005", "1"],
                    },
                ],
            },
        });
        const badges = await fetchChatterinoBadges();
        assert.equal(badges.get("100000005")?.title, "Chatterino Top Donator");
        assert.equal(badges.get("1")?.images[3], "https://fourtf.com/3.png");
    });
});
