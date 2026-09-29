import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SUGGESTED_FADE } from "../../src/components/setup/fade";
import { PRODUCTION_ORIGIN } from "../../src/components/setup/link";
import { createSetup } from "../../src/components/setup/store";
import { DEFAULT_SETTINGS, overlayPath, parseSettings } from "../../src/lib/overlay/settings";

/** The settings an overlay reads from a link. */
const settingsOf = (link: string) => parseSettings(new URL(link).searchParams);

describe("createSetup", () => {
    it("starts without a link and with the default look", () => {
        const setup = createSetup();
        assert.equal(setup.channelText(), "");
        assert.equal(setup.channel(), undefined);
        assert.equal(setup.url(), undefined);
        assert.deepEqual(setup.settings(), DEFAULT_SETTINGS);
        assert.equal(setup.changed(), false);
        assert.equal(setup.previewPath(), "/chat/preview?demo=1");
    });

    it("links to the canonical overlay path of the channel", () => {
        const setup = createSetup();
        setup.setChannelText(" https://www.twitch.tv/Some_Channel ");
        assert.equal(setup.channel(), "some_channel");
        assert.equal(setup.url(), `${PRODUCTION_ORIGIN}/chat/some_channel`);
    });

    it("has no link for what is not a channel", () => {
        const setup = createSetup();
        setup.setChannelText("two words");
        assert.equal(setup.url(), undefined);
    });

    it("uses the origin the visitor is on", () => {
        const setup = createSetup();
        setup.setChannelText("some_channel");
        setup.setOrigin("https://chat.shiftbloom.studio");
        assert.equal(setup.url(), "https://chat.shiftbloom.studio/chat/some_channel");
    });

    it("puts the chosen look into the link, whichever came first", () => {
        const setup = createSetup();
        setup.set("size", 3);
        setup.setChannelText("some_channel");
        setup.set("homies", true);
        setup.set("newline", true);
        setup.set("names", false);

        const expected = {
            ...DEFAULT_SETTINGS,
            size: 3,
            homies: true,
            newline: true,
            names: false,
        };
        assert.deepEqual(setup.settings(), expected);
        assert.equal(setup.url(), `${PRODUCTION_ORIGIN}${overlayPath("some_channel", expected)}`);
        assert.deepEqual(settingsOf(setup.url() ?? ""), expected);
        assert.equal(setup.changed(), true);
    });

    it("previews the look without the channel", () => {
        const setup = createSetup();
        setup.setChannelText("some_channel");
        setup.set("stroke", 2);
        const preview = new URL(setup.previewPath(), PRODUCTION_ORIGIN);
        assert.equal(preview.pathname, "/chat/preview");
        assert.equal(preview.searchParams.get("demo"), "1");
        assert.equal(parseSettings(preview.searchParams).stroke, 2);
    });

    it("keeps separate setups apart", () => {
        const first = createSetup();
        const second = createSetup();
        first.setChannelText("some_channel");
        first.set("caps", true);
        assert.equal(second.channelText(), "");
        assert.deepEqual(second.settings(), DEFAULT_SETTINGS);
    });
});

describe("custom font", () => {
    it("carries the name that was typed", () => {
        const setup = createSetup();
        setup.setChannelText("some_channel");
        setup.typeCustom(" Comic Sans MS ");
        assert.equal(setup.customText(), " Comic Sans MS ");
        assert.equal(setup.settings().custom, "Comic Sans MS");
        assert.equal(setup.customRefused(), false);
        assert.equal(settingsOf(setup.url() ?? "").custom, "Comic Sans MS");
    });

    it("says so when the link cannot carry the name", () => {
        const setup = createSetup();
        setup.typeCustom("Arial, sans-serif");
        assert.equal(setup.settings().custom, "");
        assert.equal(setup.customRefused(), true);
        assert.equal(setup.changed(), false);
    });

    it("has nothing to say about an empty field", () => {
        const setup = createSetup();
        setup.typeCustom("Arial");
        setup.typeCustom("  ");
        assert.equal(setup.settings().custom, "");
        assert.equal(setup.customRefused(), false);
    });
});

describe("hidden users", () => {
    it("keeps the text as typed and the names the overlay accepts", () => {
        const setup = createSetup();
        setup.typeIgnore("Second_Name, @first_name bad-name");
        assert.equal(setup.ignoreText(), "Second_Name, @first_name bad-name");
        assert.deepEqual(setup.settings().ignore, ["first_name", "second_name"]);
    });
});

describe("fading", () => {
    it("switches on with the suggested time", () => {
        const setup = createSetup();
        setup.switchFade(true);
        assert.equal(setup.settings().fade, SUGGESTED_FADE);
    });

    it("returns to the chosen time when switched off and on again", () => {
        const setup = createSetup();
        setup.switchFade(true);
        setup.typeFade("45");
        assert.equal(setup.settings().fade, 45);
        setup.switchFade(false);
        assert.equal(setup.settings().fade, 0);
        setup.switchFade(true);
        assert.equal(setup.settings().fade, 45);
    });

    it("keeps the time while the field holds no number", () => {
        const setup = createSetup();
        setup.typeFade("45");
        setup.typeFade("");
        assert.equal(setup.settings().fade, 45);
    });
});

describe("reset", () => {
    it("returns to the default look and keeps the channel", () => {
        const setup = createSetup();
        setup.setChannelText("some_channel");
        setup.set("size", 2);
        setup.typeCustom("Arial");
        setup.typeIgnore("some_name");
        setup.typeFade("45");
        setup.reset();

        assert.deepEqual(setup.settings(), DEFAULT_SETTINGS);
        assert.equal(setup.customText(), "");
        assert.equal(setup.ignoreText(), "");
        assert.equal(setup.changed(), false);
        assert.equal(setup.url(), `${PRODUCTION_ORIGIN}/chat/some_channel`);
        setup.switchFade(true);
        assert.equal(setup.settings().fade, SUGGESTED_FADE);
    });
});
