import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fetchHomiesBadges } from "../../src/lib/chat/providers/homies";
import { stubFetch } from "../helpers";

let restoreFetch = () => {};
afterEach(() => restoreFetch());

const SHARED = "https://itzalex.github.io/badges";
const SHARED_2 = "https://itzalex.github.io/badges2";
const CUSTOM = "https://chatterinohomies.com/api/badges/list";

const PAGES = "https://itzalex.github.io/badgesusers";
const CDN = "https://cdn.chatterinohomies.com/badges";

/** The most the module reads of one list. */
const MAX_BYTES = 16 * 1024 * 1024;

/** An entry of the two shared lists; only the first list numbers its badges. */
const shared = (folder: string, tooltip: string, users: unknown[], id?: string) => ({
    ...(id ? { id } : {}),
    tooltip,
    image1: `${PAGES}/${folder}/badge.png`,
    users,
    image2: `${PAGES}/${folder}/badge2x.png`,
    image3: `${PAGES}/${folder}/badge3x.png`,
});

/** An entry of the custom list. */
const custom = (uuid: string, userId: string, username: string) => ({
    badgeFileType: "image/webp",
    badgeId: `65f0c0de${userId.padStart(16, "0")}`,
    image1: `${CDN}/${uuid}/18.webp`,
    image2: `${CDN}/${uuid}/36.webp`,
    image3: `${CDN}/${uuid}/72.webp`,
    tooltip: `${username} Badge`,
    userId,
    username,
});

const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";

const DEVELOPER = { badges: [shared("dev", "Homies Developer", ["100000001"], "1")] };
const MODERATOR = { badges: [shared("mod2", "Homies Mod", ["100000002"])] };

const titles = (badges: Map<string, { title: string }[]>, user: string) =>
    badges.get(user)?.map((badge) => badge.title);

const json = (body: unknown) => new Response(JSON.stringify(body));

type Answer = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Like stubFetch, for answers that it cannot give: each URL gets a function of the request. */
function stubFetchWith(routes: Record<string, Answer>): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!(url in routes)) throw new Error(`unexpected fetch: ${url}`);
        return routes[url](init);
    }) as typeof fetch;
    return () => {
        globalThis.fetch = original;
    };
}

/** Lets everything that is ready to run do so; setImmediate stays real under mocked timers. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("Homies", () => {
    it("lists a user's shared badges before their custom one", async () => {
        restoreFetch = stubFetch({
            [SHARED]: {
                badges: [
                    shared("dev", "Homies Developer", ["100000001"], "1"),
                    shared("supporter2", "Homies Supporter", ["100000002", "100000003"], "3"),
                ],
            },
            [SHARED_2]: { badges: [shared("mod2", "Homies Mod", ["100000003"])] },
            [CUSTOM]: {
                badges: [
                    custom(UUID_A, "100000003", "invented_a"),
                    custom(UUID_B, "100000004", "invented_b"),
                ],
            },
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()].sort(), [
            "100000001",
            "100000002",
            "100000003",
            "100000004",
        ]);
        assert.deepEqual(titles(badges, "100000001"), ["Homies Developer"]);
        assert.deepEqual(titles(badges, "100000003"), [
            "Homies Supporter",
            "Homies Mod",
            "invented_a Badge",
        ]);
        assert.deepEqual(badges.get("100000004"), [
            {
                provider: "homies",
                id: `${CDN}/${UUID_B}/18.webp`,
                title: "invented_b Badge",
                images: {
                    1: `${CDN}/${UUID_B}/18.webp`,
                    2: `${CDN}/${UUID_B}/36.webp`,
                    4: `${CDN}/${UUID_B}/72.webp`,
                },
            },
        ]);
        assert.deepEqual(badges.get("100000001")?.[0].images, {
            1: `${PAGES}/dev/badge.png`,
            2: `${PAGES}/dev/badge2x.png`,
            4: `${PAGES}/dev/badge3x.png`,
        });
    });

    it("skips placeholder users and badges a user already holds", async () => {
        restoreFetch = stubFetch({
            [SHARED]: {
                badges: [
                    shared("supporter2", "Homies Supporter", ["100000002", "100000002"], "3"),
                    shared("founder2", "Homies Founder", ["100000002"], "4"),
                ],
            },
            [SHARED_2]: {
                badges: [
                    shared("dev", "Homies Developer", [""]),
                    shared("supporter2", "Homies Supporter", ["100000002"]),
                ],
            },
            [CUSTOM]: { badges: [] },
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000002"]);
        assert.deepEqual(titles(badges, "100000002"), ["Homies Supporter", "Homies Founder"]);
    });

    it("asks for the three lists only, without cookies, redirects or a preflight", async () => {
        const requests: [string, RequestInit | undefined][] = [];
        const record = (url: string) => (init: RequestInit | undefined) => {
            requests.push([url, init]);
            return json({ badges: [] });
        };
        restoreFetch = stubFetchWith({
            [SHARED]: record(SHARED),
            [SHARED_2]: record(SHARED_2),
            [CUSTOM]: record(CUSTOM),
        });
        assert.equal((await fetchHomiesBadges()).size, 0);
        assert.deepEqual(
            requests.map(([url]) => url),
            [SHARED, SHARED_2, CUSTOM],
        );
        for (const [url, init] of requests) {
            assert.equal(init?.credentials, "omit", url);
            assert.equal(init?.redirect, "error", url);
            assert.ok(init?.signal instanceof AbortSignal, url);
            // Anything but a plain GET without headers of its own would need a CORS preflight.
            assert.equal(init?.method, undefined, url);
            assert.equal(init?.headers, undefined, url);
            assert.equal(init?.body, undefined, url);
        }
    });

    it("keeps the lists that loaded when the others answer with an error", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        restoreFetch = stubFetch({ [SHARED]: DEVELOPER, [SHARED_2]: 404, [CUSTOM]: 500 });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000001"]);
        assert.deepEqual(titles(badges, "100000001"), ["Homies Developer"]);
        assert.deepEqual(
            warn.mock.calls.map((call) => String(call.arguments[0])),
            [`[chat] loading ${SHARED_2} failed`, `[chat] loading ${CUSTOM} failed`],
        );
    });

    it("keeps the lists that loaded when the others are down", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        restoreFetch = stubFetchWith({
            [SHARED]: () => {
                throw new TypeError("Failed to fetch");
            },
            [SHARED_2]: () => json(MODERATOR),
            // What a proxy in front of a dead server may answer, with status 200.
            [CUSTOM]: () => new Response("<!DOCTYPE html><title>Just a moment...</title>"),
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000002"]);
        assert.equal(warn.mock.callCount(), 2);
    });

    it("returns no badges when nothing answers", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const down = () => Promise.reject(new TypeError("Failed to fetch"));
        restoreFetch = stubFetchWith({ [SHARED]: down, [SHARED_2]: down, [CUSTOM]: down });
        assert.deepEqual(await fetchHomiesBadges(), new Map());
        assert.equal(warn.mock.callCount(), 3);
    });

    it("leaves out a list of another shape", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        for (const body of [
            null,
            42,
            "badges",
            [shared("dev", "Homies Developer", ["100000001"], "1")],
            {},
            { error: "User not found" },
            { badges: null },
            { badges: "none" },
            { badges: { 1: shared("dev", "Homies Developer", ["100000001"], "1") } },
        ]) {
            warn.mock.resetCalls();
            restoreFetch();
            restoreFetch = stubFetch({ [SHARED]: body, [SHARED_2]: MODERATOR, [CUSTOM]: body });
            const badges = await fetchHomiesBadges();
            assert.deepEqual([...badges.keys()], ["100000002"], JSON.stringify(body));
            assert.equal(warn.mock.callCount(), 2, JSON.stringify(body));
        }
        restoreFetch();
        restoreFetch = stubFetchWith({
            [SHARED]: () => new Response(null, { status: 204 }),
            [SHARED_2]: () => json(MODERATOR),
            [CUSTOM]: () => new Response(""),
        });
        assert.deepEqual([...(await fetchHomiesBadges()).keys()], ["100000002"]);
    });

    it("skips the entries of a list that make no sense", async () => {
        restoreFetch = stubFetch({
            [SHARED]: {
                badges: [
                    null,
                    7,
                    "badge",
                    [],
                    {},
                    { users: ["100000001"] },
                    { ...shared("dev", "Homies Developer", []), users: "100000001" },
                    { ...shared("dev", "Homies Developer", []), users: { 0: "100000001" } },
                    shared("supporter2", "Homies Supporter", [
                        null,
                        true,
                        12.5,
                        -3,
                        1e21,
                        "12a",
                        " 100000005",
                        "100000005\n",
                        ["100000006"],
                        { id: "100000007" },
                        100000008,
                        "100000009",
                    ]),
                ],
            },
            [SHARED_2]: { badges: [] },
            [CUSTOM]: {
                badges: [
                    { ...custom(UUID_A, "100000003", "invented_a"), userId: 100000003 },
                    { ...custom(UUID_B, "100000004", "invented_b"), tooltip: undefined },
                    { ...custom(UUID_B, "100000010", "invented_c"), tooltip: { text: "c" } },
                    { ...custom(UUID_A, "invented_d", "invented_d") },
                    { ...custom(UUID_A, "100000011", "invented_e"), userId: undefined },
                    { ...custom(UUID_A, "100000012", "invented_f"), userId: ["100000012"] },
                ],
            },
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()].sort(), [
            "100000003",
            "100000004",
            "100000008",
            "100000009",
            "100000010",
        ]);
        assert.deepEqual(titles(badges, "100000003"), ["invented_a Badge"]);
        assert.deepEqual(titles(badges, "100000004"), ["Homies"]);
        assert.deepEqual(titles(badges, "100000010"), ["Homies"]);
        assert.deepEqual(titles(badges, "100000008"), ["Homies Supporter"]);
    });

    it("takes images from the two Homies hosts only", async () => {
        restoreFetch = stubFetch({
            [SHARED]: { badges: [] },
            [SHARED_2]: { badges: [] },
            [CUSTOM]: {
                badges: [
                    {
                        ...custom(UUID_A, "100000003", "invented_a"),
                        image1: "https://elsewhere.example/18.webp",
                        image2: "http://cdn.chatterinohomies.com/badges/36.webp",
                        image3: `${CDN}/${UUID_A}/72.webp 72w, https://elsewhere.example/72.webp`,
                    },
                    {
                        ...custom(UUID_B, "100000004", "invented_b"),
                        image3: "https://cdn.chatterinohomies.com.elsewhere.example/72.webp",
                    },
                    {
                        ...custom(UUID_A, "100000005", "invented_c"),
                        image1: "https://cdn.chatterinohomies.com@elsewhere.example/18.webp",
                        image2: "https://elsewhere.example/https://cdn.chatterinohomies.com/36.webp",
                        image3: "//cdn.chatterinohomies.com/badges/72.webp",
                    },
                    {
                        ...custom(UUID_A, "100000006", "invented_d"),
                        image1: "data:image/png;base64,AAAA",
                        image2: "javascript:alert(1)",
                        image3: "https://cdn.chatterinohomies.com",
                    },
                ],
            },
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000004"]);
        assert.deepEqual(badges.get("100000004"), [
            {
                provider: "homies",
                id: `${CDN}/${UUID_B}/18.webp`,
                title: "invented_b Badge",
                images: { 1: `${CDN}/${UUID_B}/18.webp`, 2: `${CDN}/${UUID_B}/36.webp` },
            },
        ]);
    });

    it("takes an image address only as text", async () => {
        restoreFetch = stubFetch({
            [SHARED]: { badges: [] },
            [SHARED_2]: { badges: [] },
            [CUSTOM]: {
                badges: [
                    {
                        ...custom(UUID_A, "100000003", "invented_a"),
                        // Turned into text, this one would pass for an address.
                        image1: [`${CDN}/${UUID_A}/18.webp`],
                        image2: 36,
                        image3: { url: `${CDN}/${UUID_A}/72.webp` },
                    },
                    {
                        ...custom(UUID_B, "100000004", "invented_b"),
                        image1: null,
                        image2: undefined,
                    },
                ],
            },
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000004"]);
        assert.deepEqual(badges.get("100000004")?.[0], {
            provider: "homies",
            id: `${CDN}/${UUID_B}/72.webp`,
            title: "invented_b Badge",
            images: { 4: `${CDN}/${UUID_B}/72.webp` },
        });
    });

    it("reads a list of 16 MB and not a byte more", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const list = new TextEncoder().encode(JSON.stringify(DEVELOPER));
        const padded = (length: number) => {
            const body = new Uint8Array(length).fill(0x20);
            body.set(list);
            return new Response(body);
        };
        restoreFetch = stubFetchWith({
            [SHARED]: () => padded(MAX_BYTES),
            [SHARED_2]: () => json(MODERATOR),
            [CUSTOM]: () => padded(MAX_BYTES + 1),
        });
        const badges = await fetchHomiesBadges();
        assert.deepEqual([...badges.keys()], ["100000001", "100000002"]);
        assert.equal(warn.mock.callCount(), 1);
        assert.equal(warn.mock.calls[0].arguments[0], `[chat] loading ${CUSTOM} failed`);
        assert.match(String(warn.mock.calls[0].arguments[1]), /longer than 16777216 bytes/);
    });

    it("stops the download of a list that does not end", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const megabyte = new Uint8Array(1024 * 1024).fill(0x20);
        let megabytes = 0;
        let cancelled = false;
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                megabytes++;
                controller.enqueue(megabyte);
            },
            cancel() {
                cancelled = true;
            },
        });
        restoreFetch = stubFetchWith({
            [SHARED]: () => json(DEVELOPER),
            [SHARED_2]: () => json(MODERATOR),
            [CUSTOM]: () => new Response(endless),
        });
        const badges = await fetchHomiesBadges();
        await settle();
        assert.deepEqual([...badges.keys()], ["100000001", "100000002"]);
        assert.equal(cancelled, true);
        // 16 to reach the limit, one to exceed it and at most one that the stream read ahead.
        assert.ok(megabytes >= 17 && megabytes <= 18, `${megabytes} MB were read`);
        assert.equal(warn.mock.callCount(), 1);
    });

    it("gives up on a list that takes longer than 20 seconds", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const warn = t.mock.method(console, "warn", () => {});
        const signals: AbortSignal[] = [];
        const watch = (init: RequestInit | undefined) => {
            const signal = init?.signal;
            assert.ok(signal);
            signals.push(signal);
            return signal;
        };
        restoreFetch = stubFetchWith({
            // Connects and then never answers.
            [SHARED]: (init) => {
                const signal = watch(init);
                return new Promise((_, reject) => {
                    signal.addEventListener("abort", () => reject(signal.reason));
                });
            },
            [SHARED_2]: (init) => {
                watch(init);
                return json(MODERATOR);
            },
            // Answers and then stalls in the middle of the list.
            [CUSTOM]: (init) => {
                const signal = watch(init);
                return new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode('{"badges":['));
                            signal.addEventListener("abort", () => controller.error(signal.reason));
                        },
                    }),
                );
            },
        });
        let badges: Map<string, unknown> | undefined;
        const loading = fetchHomiesBadges().then((result) => {
            badges = result;
        });

        await settle();
        t.mock.timers.tick(19_999);
        await settle();
        assert.equal(badges, undefined);
        assert.deepEqual(
            signals.map((signal) => signal.aborted),
            [false, false, false],
        );

        t.mock.timers.tick(1);
        await loading;
        assert.deepEqual([...(badges?.keys() ?? [])], ["100000002"]);
        // The list that loaded in time has cleared its timer.
        assert.deepEqual(
            signals.map((signal) => signal.aborted),
            [true, false, true],
        );
        assert.deepEqual(
            warn.mock.calls.map((call) => String(call.arguments[0])),
            [`[chat] loading ${SHARED} failed`, `[chat] loading ${CUSTOM} failed`],
        );
    });

    // The tests above answer from fixtures that copy the lists as they were on 2026-09-30, so
    // they cannot notice when Homies changes them. This one asks Homies, and only on request:
    // HOMIES_LIVE=1 node --import ./test/register.ts --test test/chat/homies.test.ts
    it("reads the lists that Homies serves", {
        skip: process.env.HOMIES_LIVE !== "1",
    }, async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const badges = await fetchHomiesBadges();
        assert.deepEqual(warn.mock.calls, [], "a list failed to load");

        const held = [...badges.values()].flat();
        const from = (start: string) => held.filter((badge) => badge.id.startsWith(start)).length;
        assert.ok(from(`${PAGES}/`) > 100, "shared badges are missing");
        assert.ok(from(`${CDN}/`) > 1000, "custom badges are missing");
        assert.ok(titles(badges, "59842770")?.includes("Homies Developer"));
        for (const badge of held) {
            assert.deepEqual(Object.keys(badge.images), ["1", "2", "4"], badge.id);
        }
    });
});
