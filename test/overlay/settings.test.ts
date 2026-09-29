import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChannel } from "../../src/lib/channel";
import {
    BOT_LOGINS,
    DEFAULT_SETTINGS,
    FONTS,
    isBotMessage,
    isMessageShown,
    MAX_CUSTOM_FONT,
    MAX_FADE,
    MAX_IGNORED,
    normaliseChannelInput,
    type OverlaySettings,
    overlayPath,
    parseCustomFont,
    parseIgnoreList,
    parseSettings,
    settingsQuery,
} from "../../src/lib/overlay/settings";

const parse = (query: string) => parseSettings(new URLSearchParams(query));
const changed = (change: Partial<OverlaySettings>): OverlaySettings => ({
    ...DEFAULT_SETTINGS,
    ...change,
});

describe("DEFAULT_SETTINGS", () => {
    it("is the look the overlay had before it had settings", () => {
        assert.deepEqual(DEFAULT_SETTINGS, {
            size: 1,
            font: "system",
            stroke: 0,
            shadow: 1,
            emotes: 1,
            animate: true,
            fade: 0,
            badges: true,
            bots: true,
            commands: true,
            caps: false,
            ignore: [],
            custom: "",
            newline: false,
            names: true,
            homies: false,
        });
        assert.equal(
            FONTS.find((font) => font.id === DEFAULT_SETTINGS.font)?.family,
            '"Roboto", system-ui, sans-serif',
        );
    });
});

describe("FONTS", () => {
    it("offers five to seven fonts with unique ids that fit into a link unescaped", () => {
        assert.ok(FONTS.length >= 5 && FONTS.length <= 7);
        assert.equal(new Set(FONTS.map((font) => font.id)).size, FONTS.length);
        for (const font of FONTS) {
            assert.match(font.id, /^[a-z0-9-]+$/);
            assert.notEqual(font.label, "");
        }
    });

    it("never points to a font host", () => {
        for (const font of FONTS) assert.doesNotMatch(font.family, /url|http|\/\//i);
    });

    it("ends every stack in a generic family, so text shows while a font loads", () => {
        for (const font of FONTS) assert.match(font.family, /, (sans-serif|serif|monospace)$/);
    });
});

describe("parseSettings", () => {
    it("gives the defaults for a link without parameters", () => {
        assert.deepEqual(parse(""), DEFAULT_SETTINGS);
    });

    it("gives a list of its own, so changing it leaves the defaults alone", () => {
        assert.notEqual(parse("").ignore, DEFAULT_SETTINGS.ignore);
    });

    it("ignores parameters it does not know", () => {
        assert.deepEqual(parse("direct=1&demo=1&foo=bar&SIZE=3"), DEFAULT_SETTINGS);
    });

    it("reads every parameter", () => {
        assert.deepEqual(
            parse(
                "size=3&font=mono&stroke=2&shadow=0&emotes=2&animate=0&fade=30" +
                    "&badges=0&bots=0&commands=0&caps=1&ignore=some_bot,other_bot" +
                    "&custom=Comic%20Sans%20MS&nl=1&names=0&homies=1",
            ),
            {
                size: 3,
                font: "mono",
                stroke: 2,
                shadow: 0,
                emotes: 2,
                animate: false,
                fade: 30,
                badges: false,
                bots: false,
                commands: false,
                caps: true,
                ignore: ["other_bot", "some_bot"],
                custom: "Comic Sans MS",
                newline: true,
                names: false,
                homies: true,
            },
        );
    });

    it("reads the parameters next to those of others", () => {
        assert.deepEqual(parse("demo=1&size=2&direct=1"), changed({ size: 2 }));
    });

    for (const size of [1, 2, 3] as const) {
        it(`reads size=${size}`, () => assert.equal(parse(`size=${size}`).size, size));
    }
    for (const emotes of [1, 2, 3] as const) {
        it(`reads emotes=${emotes}`, () => assert.equal(parse(`emotes=${emotes}`).emotes, emotes));
    }
    for (const level of [0, 1, 2, 3] as const) {
        it(`reads stroke=${level} and shadow=${level}`, () => {
            assert.equal(parse(`stroke=${level}`).stroke, level);
            assert.equal(parse(`shadow=${level}`).shadow, level);
        });
    }
    for (const font of FONTS) {
        it(`reads font=${font.id}`, () => assert.equal(parse(`font=${font.id}`).font, font.id));
    }

    it("reads a font in any case", () => {
        assert.equal(parse("font=Mono").font, "mono");
        assert.equal(parse("font=%20serif%20").font, "serif");
    });

    // The parameter of each switch; all but one are named like the setting.
    const switches = [
        ["animate", "animate"],
        ["badges", "badges"],
        ["bots", "bots"],
        ["commands", "commands"],
        ["caps", "caps"],
        ["nl", "newline"],
        ["names", "names"],
        ["homies", "homies"],
    ] as const;
    for (const [parameter, key] of switches) {
        it(`reads ${parameter} as 1 and 0`, () => {
            assert.equal(parse(`${parameter}=1`)[key], true);
            assert.equal(parse(`${parameter}=0`)[key], false);
        });

        it(`reads ${parameter} as true and false`, () => {
            assert.equal(parse(`${parameter}=true`)[key], true);
            assert.equal(parse(`${parameter}=FALSE`)[key], false);
        });

        it(`keeps the default of ${parameter} for anything else`, () => {
            for (const value of ["", "2", "-1", "yes", "no", "on", "off", "null", "10"]) {
                assert.equal(parse(`${parameter}=${value}`)[key], DEFAULT_SETTINGS[key], value);
            }
        });
    }

    it("shows names and no Homies badges unless the link says otherwise", () => {
        assert.equal(parse("size=2").names, true);
        assert.equal(parse("size=2").homies, false);
        assert.equal(parse("size=2").newline, false);
        assert.equal(parse("size=2").custom, "");
    });

    it("knows the line break as nl only", () => {
        assert.equal(parse("newline=1").newline, false);
        assert.equal(parse("NL=1").newline, false);
    });

    it("leaves the Homies badges off for the parameter ChatIS had", () => {
        assert.equal(parse("show_homies=true").homies, false);
    });

    it("reads a custom font, however the link writes its spaces", () => {
        assert.equal(parse("custom=Impact").custom, "Impact");
        assert.equal(parse("custom=Comic%20Sans%20MS").custom, "Comic Sans MS");
        assert.equal(parse("custom=Comic+Sans+MS").custom, "Comic Sans MS");
        assert.equal(parse("custom=%20%20Fira%20Code%20").custom, "Fira Code");
        assert.equal(parse("custom=S%C3%B6hne").custom, "Söhne");
    });

    it("keeps the chosen font next to a custom one", () => {
        const settings = parse("font=mono&custom=Fira%20Code");
        assert.equal(settings.font, "mono");
        assert.equal(settings.custom, "Fira Code");
    });

    it("drops a custom font that is more than a name", () => {
        for (const value of [
            'Impact"',
            "Impact'",
            'Impact", serif; color: red',
            "Impact; background: url(https://elsewhere.example/a.png)",
            "Impact}body{display:none",
            "url(https://elsewhere.example/a.woff2)",
            "Impact\\22",
            "\\",
            "Impact,serif",
            "Impact/*",
            "Impact:bold",
            "Impact!important",
            "<style>",
            "@import",
            "var(--x)",
            "Imp\nact",
            "Imp\tact",
            "Imp\u0000act",
            "Imp\u2028act",
            "Imp\u00a0act",
            "🙂",
        ]) {
            const query = new URLSearchParams({ custom: value });
            assert.equal(parseSettings(query).custom, "", JSON.stringify(value));
        }
    });

    it("keeps the default for levels that do not exist", () => {
        for (const value of ["", "0", "4", "-1", "1.5", "2.0", "02", "large", "1e0", "0x1", "١"]) {
            const query = new URLSearchParams({ size: value, emotes: value });
            assert.equal(parseSettings(query).size, DEFAULT_SETTINGS.size, value);
            assert.equal(parseSettings(query).emotes, DEFAULT_SETTINGS.emotes, value);
        }
        for (const value of ["", "4", "-1", "1.5", "2.0", "02", "thick", "1e0", "9"]) {
            const query = new URLSearchParams({ stroke: value, shadow: value });
            assert.equal(parseSettings(query).stroke, DEFAULT_SETTINGS.stroke, value);
            assert.equal(parseSettings(query).shadow, DEFAULT_SETTINGS.shadow, value);
        }
    });

    it("keeps the default for a font it does not offer", () => {
        for (const value of ["", "comic", "Open Sans", "https://fonts.example/a.woff2", "a;b"]) {
            const query = new URLSearchParams({ font: value });
            assert.equal(parseSettings(query).font, DEFAULT_SETTINGS.font, value);
        }
    });

    it("reads fade as whole seconds up to the maximum", () => {
        assert.equal(MAX_FADE, 600);
        assert.equal(parse("fade=0").fade, 0);
        assert.equal(parse("fade=1").fade, 1);
        assert.equal(parse("fade=030").fade, 30);
        assert.equal(parse("fade=600").fade, 600);
    });

    it("keeps the default for a fade that is no whole number of seconds in range", () => {
        for (const value of ["", "601", "1000", "-5", "1.5", "30s", "1e2", "Infinity", "NaN"]) {
            const query = new URLSearchParams({ fade: value });
            assert.equal(parseSettings(query).fade, DEFAULT_SETTINGS.fade, value);
        }
    });

    it("uses the first value of a parameter that is given twice", () => {
        assert.equal(parse("size=3&size=2").size, 3);
    });

    it("puts the names of several ignore parameters into one list", () => {
        assert.deepEqual(parse("ignore=b_bot&ignore=a_bot,c_bot").ignore, [
            "a_bot",
            "b_bot",
            "c_bot",
        ]);
    });

    it("normalises the ignore list of a link written by hand", () => {
        assert.deepEqual(parse("ignore=@Some_Bot,%20other,,some_bot,bad-name").ignore, [
            "other",
            "some_bot",
        ]);
    });

    it("never throws, whatever the link contains", () => {
        const values = ["%", "%00", "\u0000", "🙂", " ", "a".repeat(10_000), "[]", "{}", "'\"<>"];
        const keys = [...Object.keys(DEFAULT_SETTINGS), "nl"];
        for (const value of values) {
            const query = new URLSearchParams(keys.map((key) => [key, value]));
            assert.deepEqual(parseSettings(query), DEFAULT_SETTINGS, value);
        }
    });
});

describe("settingsQuery", () => {
    it("is empty when everything is default", () => {
        assert.equal(settingsQuery(DEFAULT_SETTINGS), "");
        assert.equal(settingsQuery(parse("")), "");
    });

    it("contains only what differs from the default", () => {
        assert.equal(settingsQuery(changed({ size: 3, fade: 30 })), "?size=3&fade=30");
        assert.equal(settingsQuery(changed({ caps: true })), "?caps=1");
        assert.equal(settingsQuery(changed({ bots: false })), "?bots=0");
    });

    it("writes every parameter, always in the same order", () => {
        const everything: OverlaySettings = {
            size: 2,
            font: "serif",
            stroke: 3,
            shadow: 2,
            emotes: 3,
            animate: false,
            fade: 600,
            badges: false,
            bots: false,
            commands: false,
            caps: true,
            ignore: ["a_bot", "b_bot"],
            custom: "Fira Code",
            newline: true,
            names: false,
            homies: true,
        };
        const expected =
            "?size=2&font=serif&stroke=3&shadow=2&emotes=3&animate=0&fade=600" +
            "&badges=0&bots=0&commands=0&caps=1&ignore=a_bot,b_bot" +
            "&custom=Fira%20Code&nl=1&names=0&homies=1";
        assert.equal(settingsQuery(everything), expected);

        // The order of the properties does not matter, only the settings do.
        const reversed = Object.fromEntries(Object.entries(everything).reverse());
        assert.equal(settingsQuery(reversed as unknown as OverlaySettings), expected);
    });

    it("needs no escaping", () => {
        const query = settingsQuery(changed({ font: "mono", ignore: ["a_bot", "b_bot"] }));
        assert.equal(query, "?font=mono&ignore=a_bot,b_bot");
        assert.equal(new URL(`https://overlay.example/chat/channel${query}`).search, query);
    });

    it("escapes the name of a custom font, and nothing else", () => {
        const query = settingsQuery(changed({ custom: "Söhne Mono", newline: true }));
        assert.equal(query, "?custom=S%C3%B6hne%20Mono&nl=1");
        assert.equal(new URL(`https://overlay.example/chat/channel${query}`).search, query);
        assert.equal(parse(query).custom, "Söhne Mono");
    });

    it("writes a custom font as the overlay will read it", () => {
        assert.equal(settingsQuery(changed({ custom: "  Impact " })), "?custom=Impact");
        assert.equal(settingsQuery(changed({ custom: 'Impact"; color: red' })), "");
        assert.equal(settingsQuery(changed({ custom: "a".repeat(41) })), "");
    });

    it("survives the round trip through a link for many combinations", () => {
        const sizes = [1, 2, 3] as const;
        const levels = [0, 1, 2, 3] as const;
        const fades = [0, 1, 30, 599, 600];
        const lists = [[], ["a_bot"], ["a_bot", "b_bot", "c_bot"]];
        const customs = [
            "",
            "Impact",
            "Comic Sans MS",
            "Söhne",
            "DIN 1451 Mittelschrift Std.",
            "a-b_c",
        ];
        let combinations = 0;
        for (const size of sizes) {
            for (const stroke of levels) {
                for (const shadow of levels) {
                    for (const emotes of sizes) {
                        for (let bits = 0; bits < 256; bits++) {
                            const settings: OverlaySettings = {
                                size,
                                font: FONTS[combinations % FONTS.length].id,
                                stroke,
                                shadow,
                                emotes,
                                animate: (bits & 1) === 0,
                                fade: fades[combinations % fades.length],
                                badges: (bits & 2) === 0,
                                bots: (bits & 4) === 0,
                                commands: (bits & 8) === 0,
                                caps: (bits & 16) !== 0,
                                ignore: lists[combinations % lists.length],
                                custom: customs[combinations % customs.length],
                                newline: (bits & 32) !== 0,
                                names: (bits & 64) === 0,
                                homies: (bits & 128) !== 0,
                            };
                            const query = settingsQuery(settings);
                            assert.deepEqual(parse(query), settings, query);
                            assert.equal(settingsQuery(parse(query)), query);
                            combinations++;
                        }
                    }
                }
            }
        }
        assert.equal(combinations, 3 * 4 * 4 * 3 * 256);
    });

    it("survives the round trip with each single setting changed", () => {
        const changes: Partial<OverlaySettings>[] = [
            { size: 2 },
            { font: "alsina" },
            { stroke: 1 },
            { shadow: 0 },
            { emotes: 2 },
            { animate: false },
            { fade: 45 },
            { badges: false },
            { bots: false },
            { commands: false },
            { caps: true },
            { ignore: ["some_bot"] },
            { custom: "Fira Code" },
            { newline: true },
            { names: false },
            { homies: true },
        ];
        assert.equal(changes.length, Object.keys(DEFAULT_SETTINGS).length);
        for (const change of changes) {
            const query = settingsQuery(changed(change));
            assert.equal(query.split("&").length, 1, query);
            assert.deepEqual(parse(query), changed(change), query);
        }
    });
});

describe("parseIgnoreList", () => {
    it("gives an empty list for nothing", () => {
        assert.deepEqual(parseIgnoreList(""), []);
        assert.deepEqual(parseIgnoreList("  \n\t "), []);
        assert.deepEqual(parseIgnoreList(",,; ,"), []);
    });

    it("splits at spaces, commas, semicolons and line breaks", () => {
        assert.deepEqual(parseIgnoreList("d_bot c_bot,b_bot;a_bot\ne_bot ,  f_bot"), [
            "a_bot",
            "b_bot",
            "c_bot",
            "d_bot",
            "e_bot",
            "f_bot",
        ]);
    });

    it("accepts @name and any case", () => {
        assert.deepEqual(parseIgnoreList("@Some_Bot OTHERBOT"), ["otherbot", "some_bot"]);
    });

    it("sorts and removes duplicates", () => {
        assert.deepEqual(parseIgnoreList("zeta alpha Zeta @alpha beta"), ["alpha", "beta", "zeta"]);
    });

    it("drops what cannot be a login", () => {
        assert.deepEqual(
            parseIgnoreList(`ok_1 bad-name bad.name b@d #hash @@twice ${"a".repeat(26)} ümlaut`),
            ["ok_1"],
        );
        assert.deepEqual(parseIgnoreList("a".repeat(25)), ["a".repeat(25)]);
    });

    it("keeps the first names up to the limit", () => {
        assert.equal(MAX_IGNORED, 20);
        const names = Array.from(
            { length: 30 },
            (_, i) => `bot_${String(30 - i).padStart(2, "0")}`,
        );
        const list = parseIgnoreList(names.join(" "));
        assert.equal(list.length, 20);
        assert.deepEqual(list, names.slice(0, 20).sort());
    });

    it("does not count invalid names and duplicates towards the limit", () => {
        const names = Array.from({ length: 20 }, (_, i) => `bot_${i}`);
        const list = parseIgnoreList(`bad-name bot_0 ${names.join(",")}`);
        assert.deepEqual(list, [...names].sort());
    });

    it("leaves its own result unchanged", () => {
        const list = parseIgnoreList("c_bot, @A_Bot b_bot");
        assert.deepEqual(parseIgnoreList(list.join(",")), list);
    });
});

describe("parseCustomFont", () => {
    it("accepts names of letters, digits, spaces, hyphens, underscores and dots", () => {
        for (const name of [
            "Impact",
            "Comic Sans MS",
            "Fira Code",
            "DIN 1451 Mittelschrift Std.",
            "Source-Sans_3",
            "Söhne",
            "メイリオ",
            "7",
        ]) {
            assert.equal(parseCustomFont(name), name);
        }
    });

    it("trims the name", () => {
        assert.equal(parseCustomFont("  Impact\n"), "Impact");
        assert.equal(parseCustomFont("\tComic Sans MS "), "Comic Sans MS");
    });

    it("gives no font for nothing", () => {
        assert.equal(parseCustomFont(""), "");
        assert.equal(parseCustomFont("   "), "");
    });

    it("accepts names up to the maximum length", () => {
        assert.equal(MAX_CUSTOM_FONT, 40);
        assert.equal(parseCustomFont("a".repeat(40)), "a".repeat(40));
        assert.equal(parseCustomFont("a".repeat(41)), "");
        assert.equal(parseCustomFont(` ${"a".repeat(40)} `), "a".repeat(40));
        assert.equal(parseCustomFont("ö".repeat(40)), "ö".repeat(40));
        // Letters outside the basic plane take two units each and still count once.
        assert.equal(parseCustomFont("𝒜".repeat(40)), "𝒜".repeat(40));
        assert.equal(parseCustomFont("𝒜".repeat(41)), "");
    });

    it("drops the whole name for one character that does not belong", () => {
        const unwanted = ['"', "'", ";", ":", "{", "}", "(", ")", "\\", "/", ",", "<", ">"];
        for (const character of [...unwanted, "*", "!", "@", "#", "&", "=", "`", "\n", "\t"]) {
            assert.equal(parseCustomFont(`Im${character}pact`), "", JSON.stringify(character));
        }
    });

    it("drops attempts to leave the font name", () => {
        for (const attempt of [
            'x", serif; background: url(https://elsewhere.example/)',
            "x'; } body { display: none } .y { font-family: 'z",
            "x\\22 , serif",
            "x\\",
            "url(https://elsewhere.example/font.woff2)",
            "expression(alert(1))",
            "x</style><script>alert(1)</script>",
            "x\u0000",
            "x\u000cy",
            "x\u2028y",
        ]) {
            assert.equal(parseCustomFont(attempt), "", JSON.stringify(attempt));
        }
    });
});

describe("normaliseChannelInput", () => {
    it("is parseChannel, the one reader of channel input", () => {
        assert.equal(normaliseChannelInput, parseChannel);
        assert.equal(normaliseChannelInput(" #Some_Channel "), "some_channel");
        assert.equal(normaliseChannelInput("two words"), undefined);
    });
});

describe("overlayPath", () => {
    it("is the plain path for the default look", () => {
        assert.equal(overlayPath("some_channel", DEFAULT_SETTINGS), "/chat/some_channel");
    });

    it("carries the settings that differ", () => {
        assert.equal(
            overlayPath("some_channel", changed({ stroke: 2, ignore: ["some_bot"] })),
            "/chat/some_channel?stroke=2&ignore=some_bot",
        );
    });

    it("carries the look of the names and the Homies badges", () => {
        assert.equal(
            overlayPath(
                "some_channel",
                changed({ custom: "Comic Sans MS", newline: true, names: false, homies: true }),
            ),
            "/chat/some_channel?custom=Comic%20Sans%20MS&nl=1&names=0&homies=1",
        );
    });

    it("leads back to the same settings", () => {
        const settings = changed({
            size: 3,
            font: "display",
            fade: 20,
            commands: false,
            custom: "Fira Code",
            newline: true,
            names: false,
            homies: true,
        });
        const url = new URL(overlayPath("some_channel", settings), "https://overlay.example");
        assert.equal(url.pathname, "/chat/some_channel");
        assert.deepEqual(parseSettings(url.searchParams), settings);
    });
});

describe("BOT_LOGINS", () => {
    it("knows the common bots", () => {
        for (const login of [
            "nightbot",
            "streamelements",
            "streamlabs",
            "moobot",
            "fossabot",
            "wizebot",
            "soundalerts",
            "sery_bot",
            "pokemoncommunitygame",
            "own3d",
        ]) {
            assert.ok(BOT_LOGINS.has(login), login);
        }
    });

    it("holds logins as Twitch sends them", () => {
        for (const login of BOT_LOGINS) assert.match(login, /^[a-z0-9_]{1,25}$/);
    });
});

describe("isMessageShown", () => {
    const message = (login: string, text: string, badges: string[] = []) => ({
        login,
        text,
        badgeRefs: badges.map((set) => ({ set, version: "1" })),
    });
    const viewer = message("some_viewer", "hello chat");
    const knownBot = message("nightbot", "Follow the channel!");
    const badgedBot = message("some_custom_bot", "Follow the channel!", ["bot-badge"]);
    const command = message("some_viewer", "!uptime");

    it("shows everything by default", () => {
        for (const each of [viewer, knownBot, badgedBot, command]) {
            assert.equal(isMessageShown(each, DEFAULT_SETTINGS), true);
        }
    });

    it("tells bots by their login and by the bot badge of Twitch", () => {
        assert.equal(isBotMessage(knownBot), true);
        assert.equal(isBotMessage(message("Nightbot", "hi")), true);
        assert.equal(isBotMessage(badgedBot), true);
        assert.equal(isBotMessage(viewer), false);
        assert.equal(isBotMessage(message("some_mod", "hi", ["moderator", "subscriber"])), false);
        assert.equal(isBotMessage(message("nightbot_fan", "hi")), false);
    });

    it("hides bots when they are switched off, and only them", () => {
        const settings = changed({ bots: false });
        assert.equal(isMessageShown(knownBot, settings), false);
        assert.equal(isMessageShown(badgedBot, settings), false);
        assert.equal(isMessageShown(viewer, settings), true);
        assert.equal(isMessageShown(command, settings), true);
    });

    it("hides commands when they are switched off, and only them", () => {
        const settings = changed({ commands: false });
        assert.equal(isMessageShown(command, settings), false);
        assert.equal(isMessageShown(message("some_viewer", "!"), settings), false);
        assert.equal(isMessageShown(viewer, settings), true);
        assert.equal(isMessageShown(knownBot, settings), true);
        assert.equal(isMessageShown(message("some_viewer", "wow! nice"), settings), true);
        assert.equal(isMessageShown(message("some_viewer", "?uptime"), settings), true);
    });

    it("hides the logins of the ignore list in any case", () => {
        const settings = changed({ ignore: ["other_viewer", "some_viewer"] });
        assert.equal(isMessageShown(viewer, settings), false);
        assert.equal(isMessageShown(command, settings), false);
        assert.equal(isMessageShown(message("Some_Viewer", "hi"), settings), false);
        assert.equal(isMessageShown(message("some_viewer2", "hi"), settings), true);
        assert.equal(isMessageShown(knownBot, settings), true);
    });

    it("combines the filters", () => {
        const settings = changed({ bots: false, commands: false, ignore: ["some_viewer"] });
        for (const each of [viewer, knownBot, badgedBot, command]) {
            assert.equal(isMessageShown(each, settings), false);
        }
        assert.equal(isMessageShown(message("other_viewer", "hello"), settings), true);
    });
});
