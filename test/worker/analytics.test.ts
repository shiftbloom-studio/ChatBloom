import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { record, recordGateway } from "../../src/worker/analytics";
import type { Env } from "../../src/worker/env";

interface DataPoint {
    indexes: string[];
    blobs: string[];
    doubles: number[];
}

function dataset() {
    const points: DataPoint[] = [];
    const env = {
        ANALYTICS: { writeDataPoint: (point: DataPoint) => points.push(point) },
    } as unknown as Env;
    return { env, points };
}

describe("record", () => {
    it("stores the event as index and first blob, labels and values in their order", () => {
        const { env, points } = dataset();
        record(env, { event: "hub-tick", values: [2, 17, 5] });
        record(env, { event: "irc-refused", labels: ["rate_limited"], values: [429] });
        assert.deepEqual(points, [
            { indexes: ["hub-tick"], blobs: ["hub-tick"], doubles: [2, 17, 5] },
            {
                indexes: ["irc-refused"],
                blobs: ["irc-refused", "rate_limited"],
                doubles: [429],
            },
        ]);
    });

    it("keeps the column of a missing label", () => {
        const { env, points } = dataset();
        recordGateway(env, { route: "none", outcome: "REFUSED", status: 429 });
        recordGateway(env, {
            route: "7tv-global",
            outcome: "MISS",
            layer: "upstream",
            status: 200,
        });
        assert.deepEqual(points, [
            { indexes: ["data"], blobs: ["data", "none", "REFUSED", ""], doubles: [429] },
            {
                indexes: ["data"],
                blobs: ["data", "7tv-global", "MISS", "upstream"],
                doubles: [200],
            },
        ]);
    });

    it("stays within what a row can hold", () => {
        const { env, points } = dataset();
        record(env, {
            event: "e".repeat(200),
            labels: Array.from({ length: 30 }, () => "l".repeat(200)),
            values: [Number.NaN, Number.POSITIVE_INFINITY, ...Array.from({ length: 30 }, () => 1)],
        });
        const [point] = points;
        assert.ok(point);
        assert.equal(point.indexes[0]?.length, 64);
        assert.equal(point.blobs.length, 20);
        assert.ok(point.blobs.every((blob) => blob.length === 64));
        assert.equal(point.doubles.length, 20);
        assert.deepEqual(point.doubles.slice(0, 3), [0, 0, 1]);
    });

    it("does nothing without the binding", () => {
        assert.doesNotThrow(() => record({}, { event: "irc-connect", values: [0] }));
    });

    it("never throws and reports a broken binding once", (t) => {
        const warned = t.mock.method(console, "warn", () => {});
        const env = {
            ANALYTICS: {
                writeDataPoint: () => {
                    throw new Error("analytics unavailable");
                },
            },
        } as unknown as Env;
        for (let attempt = 0; attempt < 3; attempt++) {
            assert.doesNotThrow(() => record(env, { event: "irc-connect", values: [0] }));
        }
        assert.equal(warned.mock.callCount(), 1);
    });
});
