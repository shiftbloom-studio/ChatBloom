import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { EmoteSet } from "./emote-set";
import { TwitchIrc } from "./irc/client";
import {
    type BadgeRef,
    type EmoteRange,
    type IrcMessage,
    parseAction,
    parseBadgesTag,
    parseEmotesTag,
} from "./irc/parse";
import {
    BTTVSocket,
    type BTTVUser,
    type BTTVUsernameEffect,
    fetchBTTVBadges,
    fetchBTTVChannelEmotes,
    fetchBTTVGlobalEmotes,
} from "./providers/bttv";
import { fetchChatterinoBadges } from "./providers/chatterino";
import {
    type FFZBadges,
    FFZPubSub,
    type FFZRoom,
    fetchFFZAPBadges,
    fetchFFZBadges,
    fetchFFZGlobal,
    fetchFFZRoom,
} from "./providers/ffz";
import {
    fetchSevenTVChannel,
    fetchSevenTVEmoteSet,
    fetchSevenTVGlobalEmotes,
    fetchSevenTVPaints,
    PAINTS_PER_QUERY,
    SET_PERSONAL,
    type SevenTVEmoteSet,
    sevenTVEmotes,
} from "./providers/seventv/api";
import { channelCondition, type Entitlement, SevenTVEvents } from "./providers/seventv/events";
import type { Paint } from "./providers/seventv/paint";
import {
    defaultColor,
    fetchTwitchChannelBadges,
    fetchTwitchGlobalBadges,
    readableColor,
    resolveTwitchBadges,
    type TwitchBadges,
} from "./providers/twitch";
import { type MessagePart, tokenize } from "./tokenize";
import type { Badge } from "./types";

export interface ChatMessage {
    id: string;
    /** Room whose emotes and badges apply: the source channel for Shared Chat messages. */
    roomId: string;
    userId: string;
    login: string;
    displayName: string;
    color: string;
    action: boolean;
    text: string;
    emoteRanges: EmoteRange[];
    badgeRefs: BadgeRef[];
    /** USERNOTICE text such as "x subscribed with Prime." */
    system?: string;
}

/** Per-user cosmetics that arrive over provider sockets, often after the user's first message. */
export interface ChatUser {
    paintId?: string;
    sevenTVBadgeId?: string;
    bttvBadge?: Badge;
    bttvEffect?: BTTVUsernameEffect;
    /** Bumped whenever the user's personal emotes change so their messages re-tokenize. */
    personalEmotes: number;
}

interface Room {
    id: string;
    sevenTV: EmoteSet;
    sevenTVSetId?: string;
    sevenTVUserId?: string;
    bttv: EmoteSet;
    ffz?: FFZRoom;
    ffzSetIds: string[];
    twitchBadges?: TwitchBadges;
}

export interface ChatSessionOptions {
    maxMessages?: number;
}

export type ChatSession = ReturnType<typeof createChatSession>;

/**
 * How many message ids are remembered to tell a repeated message from a new one. Independent
 * of how many messages are on screen, and several times what the relay replays (50 lines).
 */
const SEEN_IDS = 500;

/**
 * Connects to a channel's chat and every emote and cosmetics provider (Twitch, 7TV, BTTV, FFZ,
 * FFZ:AP, Chatterino), keeping all of it live. Provider data lives in plain maps; the version
 * signals and the store tell components when to re-derive message parts and badges.
 */
export function createChatSession(channel: string, options: ChatSessionOptions = {}) {
    const maxMessages = options.maxMessages ?? 100;

    const [state, setState] = createStore({
        status: "connecting" as "connecting" | "connected",
        roomId: undefined as string | undefined,
        messages: [] as ChatMessage[],
        users: {} as Record<string, ChatUser>,
        paints: {} as Record<string, Paint>,
        sevenTVBadges: {} as Record<string, Badge>,
    });

    const [emotesVersion, setEmotesVersion] = createSignal(0);
    const [badgesVersion, setBadgesVersion] = createSignal(0);
    // Coalesce bursts (e.g. a provider loading) into one re-derivation.
    const coalesce = (bump: () => void) => {
        let queued = false;
        return () => {
            if (queued) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                bump();
            });
        };
    };
    const emotesChanged = coalesce(() => setEmotesVersion((v) => v + 1));
    const badgesChanged = coalesce(() => setBadgesVersion((v) => v + 1));

    const global = {
        sevenTV: new EmoteSet(),
        bttv: new EmoteSet(),
        ffzDefaultSets: [] as string[],
        ffzUserSets: new Map<string, string[]>(),
        twitchBadges: new Map() as TwitchBadges,
        bttvBadges: new Map<string, Badge>(),
        ffzBadges: { badges: new Map(), users: new Map() } as FFZBadges,
        ffzapBadges: new Map<string, Badge>(),
        chatterinoBadges: new Map<string, Badge>(),
    };
    const rooms = new Map<string, Room>();
    /** Every FFZ set by id (global, room and user sets), so pubsub edits find their set. */
    const ffzSets = new Map<string, EmoteSet>();
    /** Every 7TV set by id (channel and personal), so EventAPI edits find their set. */
    const sevenTVSets = new Map<string, EmoteSet>();
    const personalSetIds = new Map<string, Set<string>>();
    const personalSetOwners = new Map<string, Set<string>>();
    const bttvPersonal = new Map<string, EmoteSet>();

    const load = (label: string, task: () => Promise<void>) =>
        task().catch((error) => console.warn(`[chat] loading ${label} failed`, error));

    const patchUser = (twitchId: string, patch: (user: ChatUser) => Partial<ChatUser>) =>
        setState("users", twitchId, (user = { personalEmotes: 0 }) => ({
            ...user,
            ...patch(user),
        }));
    const personalEmotesChanged = (twitchId: string) =>
        patchUser(twitchId, (user) => ({ personalEmotes: user.personalEmotes + 1 }));

    // 7TV only sends a paint's first layer over v3, so each new paint is re-fetched from v4.
    const paintQueue = new Set<string>();
    const upgradePaints = coalesce(() => {
        const ids = [...paintQueue].slice(0, PAINTS_PER_QUERY);
        for (const id of ids) paintQueue.delete(id);
        if (paintQueue.size > 0) upgradePaints();
        load("7TV v4 paints", async () => {
            for (const paint of await fetchSevenTVPaints(ids)) {
                const current = state.paints[paint.id];
                if (JSON.stringify(current?.layers) === JSON.stringify(paint.layers)) continue;
                setState("paints", paint.id, paint);
            }
        });
    });

    const sevenTV = new SevenTVEvents({
        onEmoteSetChange(setId, change) {
            const set = sevenTVSets.get(setId);
            if (!set) return;
            for (const id of change.removed) set.remove(id);
            for (const emote of change.added) set.add(emote);
            const owners = personalSetOwners.get(setId);
            if (owners) for (const owner of owners) personalEmotesChanged(owner);
            else emotesChanged();
        },
        onEmoteSetCreate(setId, flags) {
            if (flags & SET_PERSONAL && !sevenTVSets.has(setId))
                sevenTVSets.set(setId, new EmoteSet());
        },
        onPaint(paint) {
            if (!state.paints[paint.id]) {
                paintQueue.add(paint.id);
                upgradePaints();
            }
            setState("paints", paint.id, paint);
        },
        onBadge(badge) {
            setState("sevenTVBadges", badge.id, badge);
        },
        onEntitlement: entitlementChanged,
        onUserEmoteSet(sevenTVUserId, setId) {
            for (const room of rooms.values()) {
                if (room.sevenTVUserId !== sevenTVUserId || room.sevenTVSetId === setId) continue;
                load("7TV emote set", async () => {
                    const set = await fetchSevenTVEmoteSet(setId);
                    if (set) useSevenTVSet(room, set);
                });
            }
        },
    });

    function entitlementChanged({ kind, refId, twitchId }: Entitlement, granted: boolean) {
        if (kind === "PAINT") {
            patchUser(twitchId, (user) => ({
                paintId: granted ? refId : user.paintId === refId ? undefined : user.paintId,
            }));
        } else if (kind === "BADGE") {
            patchUser(twitchId, (user) => ({
                sevenTVBadgeId: granted
                    ? refId
                    : user.sevenTVBadgeId === refId
                      ? undefined
                      : user.sevenTVBadgeId,
            }));
        } else {
            const ids = personalSetIds.get(twitchId) ?? new Set();
            const owners = personalSetOwners.get(refId) ?? new Set();
            if (granted) {
                personalSetIds.set(twitchId, ids.add(refId));
                personalSetOwners.set(refId, owners.add(twitchId));
                if (!sevenTVSets.has(refId)) {
                    sevenTVSets.set(refId, new EmoteSet());
                    // The EventAPI usually follows up with the set's contents; fetch in case not.
                    load("7TV personal emotes", async () => {
                        const set = await fetchSevenTVEmoteSet(refId);
                        for (const emote of sevenTVEmotes(set)) sevenTVSets.get(refId)?.add(emote);
                        for (const owner of personalSetOwners.get(refId) ?? []) {
                            personalEmotesChanged(owner);
                        }
                    });
                }
            } else {
                ids.delete(refId);
                owners.delete(twitchId);
            }
            personalEmotesChanged(twitchId);
        }
    }

    function useSevenTVSet(room: Room, set: SevenTVEmoteSet) {
        if (room.sevenTVSetId) sevenTV.unsubscribe("emote_set.*", { object_id: room.sevenTVSetId });
        room.sevenTVSetId = set.id;
        room.sevenTV = new EmoteSet(sevenTVEmotes(set));
        sevenTVSets.set(set.id, room.sevenTV);
        sevenTV.subscribe("emote_set.*", { object_id: set.id });
        emotesChanged();
    }

    const bttv = new BTTVSocket({
        onEmoteAdd(channelId, emote) {
            rooms.get(channelId)?.bttv.add(emote);
            emotesChanged();
        },
        onEmoteRename(channelId, emoteId, name) {
            rooms.get(channelId)?.bttv.rename(emoteId, name);
            emotesChanged();
        },
        onEmoteRemove(channelId, emoteId) {
            rooms.get(channelId)?.bttv.remove(emoteId);
            emotesChanged();
        },
        onUser(user: BTTVUser) {
            patchUser(user.twitchId, () => ({ bttvBadge: user.badge, bttvEffect: user.effect }));
            if (user.emotes.length > 0) {
                bttvPersonal.set(user.twitchId, new EmoteSet(user.emotes));
                personalEmotesChanged(user.twitchId);
            }
        },
    });

    const ffz = new FFZPubSub({
        onEmoteAdd(setId, emote) {
            ffzSets.get(setId)?.add(emote);
            emotesChanged();
        },
        onEmoteRemove(setId, emoteId) {
            ffzSets.get(setId)?.remove(emoteId);
            emotesChanged();
        },
    });

    function loadRoom(roomId: string) {
        if (rooms.has(roomId)) return;
        const room: Room = {
            id: roomId,
            sevenTV: new EmoteSet(),
            bttv: new EmoteSet(),
            ffzSetIds: [],
        };
        rooms.set(roomId, room);

        load("7TV channel", async () => {
            const channel = await fetchSevenTVChannel(roomId);
            if (!channel) return;
            room.sevenTVUserId = channel.userId;
            sevenTV.subscribe("user.*", { object_id: channel.userId });
            if (channel.emoteSet) useSevenTVSet(room, channel.emoteSet);
        });
        // Cosmetics, entitlements and personal emote sets of the people chatting here.
        for (const type of ["cosmetic.*", "entitlement.*", "emote_set.*"]) {
            sevenTV.subscribe(type, channelCondition(roomId));
        }

        load("BTTV channel", async () => {
            const emotes = await fetchBTTVChannelEmotes(roomId);
            if (!emotes) return;
            for (const emote of emotes) room.bttv.add(emote);
            emotesChanged();
        });
        bttv.join(roomId);

        load("FFZ room", async () => {
            const ffzRoom = await fetchFFZRoom(roomId);
            if (!ffzRoom) return;
            for (const [id, emotes] of ffzRoom.sets) ffzSets.set(id, new EmoteSet(emotes));
            room.ffz = ffzRoom;
            room.ffzSetIds = [...ffzRoom.sets.keys()];
            emotesChanged();
            badgesChanged();
        });
        ffz.subscribe(roomId);

        load("Twitch channel badges", async () => {
            room.twitchBadges = await fetchTwitchChannelBadges(roomId);
            badgesChanged();
        });
    }

    load("7TV global emotes", async () => {
        global.sevenTV = new EmoteSet(await fetchSevenTVGlobalEmotes());
        emotesChanged();
    });
    load("BTTV global emotes", async () => {
        global.bttv = new EmoteSet(await fetchBTTVGlobalEmotes());
        emotesChanged();
    });
    load("FFZ global emotes", async () => {
        const data = await fetchFFZGlobal();
        for (const [id, emotes] of data.sets) ffzSets.set(id, new EmoteSet(emotes));
        global.ffzDefaultSets = data.defaultSets;
        global.ffzUserSets = data.userSets;
        emotesChanged();
    });
    const loadBadges = (label: string, task: () => Promise<void>) =>
        load(label, async () => {
            await task();
            badgesChanged();
        });
    loadBadges("Twitch global badges", async () => {
        global.twitchBadges = await fetchTwitchGlobalBadges();
    });
    loadBadges("BTTV badges", async () => {
        global.bttvBadges = await fetchBTTVBadges();
    });
    loadBadges("FFZ badges", async () => {
        global.ffzBadges = await fetchFFZBadges();
    });
    loadBadges("FFZ:AP badges", async () => {
        global.ffzapBadges = await fetchFFZAPBadges();
    });
    loadBadges("Chatterino badges", async () => {
        global.chatterinoBadges = await fetchChatterinoBadges();
    });

    /** Ids of the latest messages in the order they arrived, deleted messages included. */
    const seenIds = new Set<string>();

    function addMessage(message: ChatMessage) {
        // The relay replays the channel's latest lines to every new connection, so after a
        // reconnect most of them are already on screen.
        if (seenIds.has(message.id)) return;
        seenIds.add(message.id);
        if (seenIds.size > SEEN_IDS) {
            for (const oldest of seenIds) {
                seenIds.delete(oldest);
                break;
            }
        }
        loadRoom(message.roomId);
        setState("messages", (messages) => [...messages.slice(1 - maxMessages), message]);
    }

    function removeMessages(predicate: (message: ChatMessage) => boolean) {
        setState("messages", (messages) => messages.filter((message) => !predicate(message)));
    }

    function chatMessage(message: IrcMessage, body: string, system?: string): ChatMessage {
        const { tags } = message;
        const { text, action } = parseAction(body);
        const login = tags.login || message.nick || "";
        // Shared Chat: messages from the other channels carry their own room and badges.
        const sourceRoom = tags["source-room-id"];
        const shared = !!sourceRoom && sourceRoom !== tags["room-id"];
        return {
            id: tags.id || crypto.randomUUID(),
            roomId: shared ? sourceRoom : tags["room-id"],
            userId: tags["user-id"] ?? "",
            login,
            displayName: tags["display-name"] || login,
            color: readableColor(tags.color || defaultColor(login)),
            action,
            text,
            emoteRanges: parseEmotesTag(tags.emotes),
            badgeRefs: parseBadgesTag(
                shared ? (tags["source-badges"] ?? tags.badges) : tags.badges,
            ),
            system,
        };
    }

    const irc = new TwitchIrc({
        channel,
        onStatus: (status) => setState("status", status),
        onMessage(message) {
            const { tags } = message;
            switch (message.command) {
                case "ROOMSTATE":
                    if (tags["room-id"] && !state.roomId) {
                        setState("roomId", tags["room-id"]);
                        loadRoom(tags["room-id"]);
                    }
                    break;
                case "PRIVMSG":
                    addMessage(chatMessage(message, message.params[1] ?? ""));
                    break;
                case "USERNOTICE":
                    addMessage(chatMessage(message, message.params[1] ?? "", tags["system-msg"]));
                    break;
                case "CLEARCHAT": {
                    const target = tags["target-user-id"];
                    removeMessages((m) => !target || m.userId === target);
                    break;
                }
                case "CLEARMSG":
                    removeMessages((m) => m.id === tags["target-msg-id"]);
                    break;
            }
        },
    });

    /** Message parts; re-derived when any emote source the message draws from changes. */
    function parts(message: ChatMessage): MessagePart[] {
        // Read purely to subscribe: global/room set changes, and this user's personal emotes.
        emotesVersion();
        void state.users[message.userId]?.personalEmotes;

        const room = rooms.get(message.roomId);
        const sets = [
            ...[...(personalSetIds.get(message.userId) ?? [])].map((id) => sevenTVSets.get(id)),
            bttvPersonal.get(message.userId),
            room?.sevenTV,
            room?.bttv,
            ...(room?.ffzSetIds ?? []).map((id) => ffzSets.get(id)),
            ...(global.ffzUserSets.get(message.login) ?? []).map((id) => ffzSets.get(id)),
            global.sevenTV,
            global.bttv,
            ...global.ffzDefaultSets.map((id) => ffzSets.get(id)),
        ].filter((set) => set !== undefined);

        return tokenize(message.text, message.emoteRanges, (name) => {
            for (const set of sets) {
                const emote = set.get(name);
                if (emote) return emote;
            }
            return undefined;
        });
    }

    /** Badges in display order; re-derived when badge data or the user's cosmetics change. */
    function badges(message: ChatMessage): Badge[] {
        badgesVersion();
        const room = rooms.get(message.roomId);
        // Each slot remembers its Twitch badge set, which FFZ badges may take over.
        const slots = message.badgeRefs.flatMap((ref) => {
            const [badge] = resolveTwitchBadges([ref], room?.twitchBadges, global.twitchBadges);
            if (!badge) return [];
            if (ref.set === "moderator" && room?.ffz?.moderatorBadge) {
                return [{ set: ref.set, badge: room.ffz.moderatorBadge }];
            }
            if (ref.set === "vip" && room?.ffz?.vipBadge) {
                return [{ set: ref.set, badge: room.ffz.vipBadge }];
            }
            return [{ set: ref.set, badge }];
        });

        const ffzIds = new Set(global.ffzBadges.users.get(message.userId));
        for (const [id, users] of room?.ffz?.userBadges ?? []) {
            if (users.includes(message.userId)) ffzIds.add(id);
        }
        for (const id of ffzIds) {
            const badge = global.ffzBadges.badges.get(id);
            if (!badge) continue;
            const replaced = badge.replaces ? slots.findIndex((s) => s.set === badge.replaces) : -1;
            if (replaced === -1) slots.push({ set: "", badge });
            else slots[replaced] = { set: slots[replaced].set, badge };
        }
        const result = slots.map((slot) => slot.badge);

        const user = state.users[message.userId];
        const sevenTVBadge = user?.sevenTVBadgeId
            ? state.sevenTVBadges[user.sevenTVBadgeId]
            : undefined;
        const extra = [
            sevenTVBadge,
            user?.bttvBadge ?? global.bttvBadges.get(message.userId),
            global.ffzapBadges.get(message.userId),
            global.chatterinoBadges.get(message.userId),
        ];
        return [...result, ...extra.filter((badge) => badge !== undefined)];
    }

    function paint(message: ChatMessage): Paint | undefined {
        const id = state.users[message.userId]?.paintId;
        return id ? state.paints[id] : undefined;
    }

    return {
        state,
        parts,
        badges,
        paint,
        user: (message: ChatMessage): ChatUser | undefined => state.users[message.userId],
        dispose() {
            irc.close();
            sevenTV.close();
            bttv.close();
            ffz.close();
        },
    };
}
