// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import { DeviceId, EventId, TaskId, type Event } from "@yatma/core";
import * as Effect from "effect/Effect";

import * as EventStore from "./eventStore.ts";
import * as NodeSqlite from "./testing/nodeSqlite.ts";

const DEVICE = { kind: "user" as const, deviceId: DeviceId.make("device_test") };

function ulid(seed: string): string {
  const base = seed.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "0");
  return (base + "00000000000000000000000000").slice(0, 26);
}

function taskCreated(input: {
  readonly id: string;
  readonly taskId: string;
  readonly at: string;
  readonly title?: string;
}): Event {
  return {
    v: 1,
    type: "task.created",
    id: EventId.make(input.id),
    at: input.at,
    by: DEVICE,
    taskId: TaskId.make(input.taskId),
    projectId: null,
    title: input.title ?? "Buy milk",
    status: "todo",
    quadrant: null,
    position: "n",
  };
}

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  EventStore.migrate.pipe(
    Effect.andThen(effect),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );

describe("eventStore", () => {
  it.effect("ignores duplicate push ids and assigns seq", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const event = taskCreated({
          id: ulid("01DUPTESTEVENT00000000001"),
          taskId: "t_ABCDEFGH",
          at: now,
        });
        const first = yield* EventStore.pushEvents([event], now);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.result.accepted).toHaveLength(1);
        expect(first.result.assigned[0]?.seq).toBe(1);

        const second = yield* EventStore.pushEvents([event], now);
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.result.accepted).toHaveLength(0);
        expect(second.result.assigned).toHaveLength(0);
      }),
    ),
  );

  it.effect("returns events after cursor", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const a = taskCreated({
          id: ulid("01CURSORAAAA000000000001"),
          taskId: "t_AAAAAAAA",
          at: now,
          title: "A",
        });
        const b = taskCreated({
          id: ulid("01CURSORBBBB000000000001"),
          taskId: "t_BBBBBBBB",
          at: now,
          title: "B",
        });
        yield* EventStore.pushEvents([a, b], now);
        const after0 = yield* EventStore.eventsAfter(0);
        expect(after0.events.map((e) => e.id)).toEqual([a.id, b.id]);
        const after1 = yield* EventStore.eventsAfter(1);
        expect(after1.events.map((e) => e.id)).toEqual([b.id]);
        expect(after1.after).toBe(2);
      }),
    ),
  );

  it.effect("rejects clock skew more than one day ahead", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const skew = taskCreated({
          id: ulid("01SKEWTESTEVENT0000000001"),
          taskId: "t_SKEWSKEW",
          at: "2026-10-08T00:00:01.000Z",
        });
        const result = yield* EventStore.pushEvents([skew], now);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reject._tag).toBe("clock_skew");
      }),
    ),
  );

  it.effect("folds entities from pushed events", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const created = taskCreated({
          id: ulid("01FOLDTESTEVENT0000000001"),
          taskId: "t_ABCDEF01",
          at: now,
          title: "Fold me",
        });
        yield* EventStore.pushEvents([created], now);
        const entity = yield* EventStore.getEntity("t_ABCDEF01");
        expect(entity?.kind).toBe("task");
        expect((entity?.state as { title: string }).title).toBe("Fold me");
      }),
    ),
  );
});
