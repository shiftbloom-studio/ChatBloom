import { ReconnectingSocket } from "../../socket";
import type { Badge, Emote } from "../../types";
import { type SevenTVActiveEmote, sevenTVBadge, sevenTVEmote } from "./api";
import { type Paint, paintFromV3, type V3PaintData } from "./paint";

const EVENTS_URL = "wss://events.7tv.io/v3";

const Op = {
    Dispatch: 0,
    Hello: 1,
    Heartbeat: 2,
    Reconnect: 4,
    Error: 6,
    EndOfStream: 7,
    Subscribe: 35,
    Unsubscribe: 36,
} as const;

export type SevenTVCondition = Record<string, string>;

export const channelCondition = (twitchId: string): SevenTVCondition => ({
    ctx: "channel",
    platform: "TWITCH",
    id: twitchId,
});

export interface EmoteSetChange {
    added: Emote[];
    /** Emote ids; a rename shows up as a removal followed by an addition. */
    removed: string[];
}

export interface Entitlement {
    kind: "PAINT" | "BADGE" | "EMOTE_SET";
    refId: string;
    twitchId: string;
}

export interface SevenTVEventHandlers {
    onEmoteSetChange: (setId: string, change: EmoteSetChange) => void;
    onEmoteSetCreate: (setId: string, flags: number) => void;
    onPaint: (paint: Paint) => void;
    onBadge: (badge: Badge) => void;
    onEntitlement: (entitlement: Entitlement, granted: boolean) => void;
    /** A channel owner switched their active emote set, or deactivated it (`undefined`). */
    onUserEmoteSet: (sevenTVUserId: string, setId: string | undefined) => void;
    /**
     * A new connection follows one that was lost, and it is subscribed again. 7TV does not
     * replay what it dispatched in between, so whatever changed meanwhile has to be fetched.
     */
    onReconnect?: () => void;
}

interface ChangeField {
    key: string;
    index?: number;
    value?: unknown;
    old_value?: unknown;
}

interface DispatchBody {
    id: string;
    object?: Record<string, unknown>;
    pushed?: ChangeField[];
    pulled?: ChangeField[];
    updated?: ChangeField[];
}

export function emoteSetChange(body: DispatchBody): EmoteSetChange {
    const added: Emote[] = [];
    const removed: string[] = [];
    for (const field of body.pulled ?? []) {
        if (field.key === "emotes") removed.push((field.old_value as SevenTVActiveEmote).id);
    }
    for (const field of body.updated ?? []) {
        if (field.key !== "emotes") continue;
        removed.push((field.old_value as SevenTVActiveEmote).id);
        const emote = sevenTVEmote(field.value as SevenTVActiveEmote);
        if (emote) added.push(emote);
    }
    for (const field of body.pushed ?? []) {
        if (field.key !== "emotes") continue;
        const emote = sevenTVEmote(field.value as SevenTVActiveEmote);
        if (emote) added.push(emote);
    }
    return { added, removed };
}

/**
 * The emote sets a `user.update` makes active: `undefined` when the user deactivated theirs.
 * 7TV sends the change once for each of the user's connections, as a nested `emote_set` field
 * whose value is the new set, or null for none.
 */
export function activeEmoteSets(body: DispatchBody): Set<string | undefined> {
    const sets = new Set<string | undefined>();
    for (const field of body.updated ?? []) {
        if (field.key !== "connections" || !Array.isArray(field.value)) continue;
        for (const nested of field.value as ChangeField[]) {
            if (nested.key !== "emote_set") continue;
            const set = nested.value as { id?: unknown } | null | undefined;
            if (set == null) sets.add(undefined);
            else if (typeof set.id === "string") sets.add(set.id);
        }
    }
    return sets;
}

function twitchConnection(user: unknown): string | undefined {
    const connections = (user as { connections?: { platform: string; id: string }[] })?.connections;
    return connections?.find((c) => c.platform === "TWITCH")?.id;
}

/** Client for the 7TV EventAPI; subscriptions survive reconnects. */
export class SevenTVEvents {
    #socket: ReconnectingSocket;
    #subscriptions = new Map<string, { type: string; condition: SevenTVCondition }>();
    #handlers: SevenTVEventHandlers;
    /** Whether a connection has said hello before, so that the next one follows a gap. */
    #greeted = false;

    constructor(handlers: SevenTVEventHandlers) {
        this.#handlers = handlers;
        this.#socket = new ReconnectingSocket({
            label: "7tv-events",
            url: () => EVENTS_URL,
            onMessage: (data) => this.#onMessage(data),
        });
        this.#socket.start();
    }

    subscribe(type: string, condition: SevenTVCondition): void {
        const key = JSON.stringify([type, condition]);
        if (this.#subscriptions.has(key)) return;
        this.#subscriptions.set(key, { type, condition });
        this.#send(Op.Subscribe, { type, condition });
    }

    unsubscribe(type: string, condition: SevenTVCondition): void {
        if (this.#subscriptions.delete(JSON.stringify([type, condition]))) {
            this.#send(Op.Unsubscribe, { type, condition });
        }
    }

    close(): void {
        this.#socket.stop();
    }

    #send(op: number, d: unknown): void {
        this.#socket.send(JSON.stringify({ op, d }));
    }

    #onMessage(data: string): void {
        const message = JSON.parse(data) as { op: number; d: Record<string, unknown> };
        switch (message.op) {
            case Op.Hello: {
                const interval = Number(message.d.heartbeat_interval) || 45_000;
                this.#socket.keepAlive(interval * 3);
                // The protocol has a Resume op to replay missed dispatches, but 7TV's server
                // answers it with `success: false` and replays nothing (`apps/event-api/src/
                // http/v3/mod.rs` in SevenTV/SevenTV), so a new session subscribes from scratch.
                for (const subscription of this.#subscriptions.values()) {
                    this.#send(Op.Subscribe, subscription);
                }
                if (this.#greeted) this.#handlers.onReconnect?.();
                this.#greeted = true;
                break;
            }
            case Op.Reconnect:
            case Op.EndOfStream:
                this.#socket.reconnect();
                break;
            case Op.Error:
                console.warn("[7tv-events]", message.d);
                break;
            case Op.Dispatch:
                this.#dispatch(message.d.type as string, message.d.body as DispatchBody);
                break;
        }
    }

    #dispatch(type: string, body: DispatchBody): void {
        const handlers = this.#handlers;
        const object = body.object;
        switch (type) {
            case "emote_set.update":
                handlers.onEmoteSetChange(body.id, emoteSetChange(body));
                break;
            case "emote_set.create":
                handlers.onEmoteSetCreate(body.id, Number(object?.flags) || 0);
                break;
            case "cosmetic.create":
            case "cosmetic.update": {
                if (object?.kind === "PAINT")
                    handlers.onPaint(paintFromV3(object.data as V3PaintData));
                if (object?.kind === "BADGE") {
                    handlers.onBadge(
                        sevenTVBadge(object.data as Parameters<typeof sevenTVBadge>[0]),
                    );
                }
                break;
            }
            case "entitlement.create":
            case "entitlement.delete": {
                const twitchId = twitchConnection(object?.user);
                const kind = object?.kind as Entitlement["kind"];
                if (!twitchId || !["PAINT", "BADGE", "EMOTE_SET"].includes(kind)) break;
                handlers.onEntitlement(
                    { kind, refId: object?.ref_id as string, twitchId },
                    type === "entitlement.create",
                );
                break;
            }
            case "user.update":
                for (const setId of activeEmoteSets(body)) handlers.onUserEmoteSet(body.id, setId);
                break;
        }
    }
}
