import type { Env } from "./env";

/**
 * One row of the Analytics Engine dataset. Rows hold counters and nothing else: never a
 * channel, a user name or a line of chat.
 *
 * | event         | blob2     | blob3        | blob4       | double1 | double2..         |
 * | ------------- | --------- | ------------ | ----------- | ------- | ----------------- |
 * | `irc-connect` |           |              |             | shard   |                   |
 * | `irc-refused` | reason    |              |             | status  | shard, once known |
 * | `data`        | route id  | cache status | cache layer | status  |                   |
 * | `hub-tick`    |           |              |             | shard   | see `hub.ts`      |
 *
 * Keep the number of rows low: one per connect, one per gateway request and one per alarm of
 * a hub at most. A Worker invocation may write 250 rows.
 */
export interface Measurement {
    /** A fixed word; stored as the index, by which rows are sampled, and as `blob1`. */
    event: string;
    /** Fixed words, stored from `blob2` on. A missing one keeps its column, left empty. */
    labels?: readonly (string | undefined)[];
    /** Shard numbers, status codes and counts, stored from `double1` on. */
    values?: readonly number[];
}

/** What the data gateway reports about a request it answered. */
export interface GatewayMeasurement {
    route: string;
    outcome: string;
    layer?: string;
    status: number;
}

/** Analytics Engine takes 20 blobs and 20 doubles per row. */
const MAX_LABELS = 19;
const MAX_VALUES = 20;
/** No label is a sentence. The index, which holds the event, may be 96 bytes long. */
const MAX_LABEL_LENGTH = 64;

let failureReported = false;

/**
 * Writes one row. Does nothing without the binding and never throws: counting must not be
 * able to break what it counts. The write is buffered by the runtime, so nothing is awaited.
 */
export function record(env: Pick<Env, "ANALYTICS">, measurement: Measurement): void {
    try {
        const dataset = env.ANALYTICS;
        if (!dataset) return;
        const event = measurement.event.slice(0, MAX_LABEL_LENGTH);
        const labels = (measurement.labels ?? [])
            .slice(0, MAX_LABELS)
            .map((label) => (label ?? "").slice(0, MAX_LABEL_LENGTH));
        const values = (measurement.values ?? [])
            .slice(0, MAX_VALUES)
            .map((value) => (Number.isFinite(value) ? value : 0));
        dataset.writeDataPoint({ indexes: [event], blobs: [event, ...labels], doubles: values });
    } catch (error) {
        // Once per isolate: a broken binding would otherwise write a log line per request.
        if (failureReported) return;
        failureReported = true;
        console.warn("analytics write failed", error instanceof Error ? error.name : "unknown");
    }
}

export function recordGateway(env: Pick<Env, "ANALYTICS">, event: GatewayMeasurement): void {
    record(env, {
        event: "data",
        labels: [event.route, event.outcome, event.layer],
        values: [event.status],
    });
}
