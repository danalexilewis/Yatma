// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import {
  DeviceId,
  EventId,
  TaskId,
  foldEvents,
  type Event,
} from "@yatma/core";
import * as Effect from "effect/Effect";

import * as EventStore from "./eventStore.ts";
import * as NodeSqlite from "./testing/nodeSqlite.ts";

const DEVICE_A = { kind: "user" as const, deviceId: DeviceId.make("device_a") };
const DEVICE_B = { kind: "user" as const, deviceId: DeviceId.make("device_b") };

function ulid(seed: string): string {
  const base = seed.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "0");
  return (base + "00000000000000000000000000").slice(0, 26);
}

function taskCreated(input: {
  readonly id: string;
  readonly taskId: string;
  readonly at: string;
  readonly title: string;
  readonly by: typeof DEVICE_A;
}): Event {
  return {
    v: 1,
    type: "task.created",
    id: EventId.make(input.id),
    at: input.at,
    by: input.by,
    taskId: TaskId.make(input.taskId),
    projectId: null,
    title: input.title,
    status: "todo",
    quadrant: null,
    position: "n",
  };
}

function taskUpdated(input: {
  readonly id: string;
  readonly taskId: string;
  readonly at: string;
  readonly title: string;
  readonly by: typeof DEVICE_A;
}): Event {
  return {
    v: 1,
    type: "task.updated",
    id: EventId.make(input.id),
    at: input.at,
    by: input.by,
    taskId: TaskId.make(input.taskId),
    set: { title: input.title },
  };
}

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  EventStore.migrate.pipe(
    Effect.andThen(effect),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );

describe("eventStore convergence", () => {
  it.effect("two logical devices push interleaved events and fold converges", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T12:00:00.000Z";
        const taskId = "t_CNV001AA";

        // Device A creates; device B updates title; device A updates notes — interleaved pushes.
        const create = taskCreated({
          id: ulid("01CONVA000000000000000001"),
          taskId,
          at: "2026-10-06T12:00:00.000Z",
          title: "From A",
          by: DEVICE_A,
        });
        const updateB = taskUpdated({
          id: ulid("01CONVB000000000000000001"),
          taskId,
          at: "2026-10-06T12:00:01.000Z",
          title: "From B",
          by: DEVICE_B,
        });
        const updateA = taskUpdated({
          id: ulid("01CONVA000000000000000002"),
          taskId,
          at: "2026-10-06T12:00:02.000Z",
          title: "From A again",
          by: DEVICE_A,
        });

        // Simulate two devices pushing in interleaved order (not creation order).
        const pushA1 = yield* EventStore.pushEvents([create], now);
        expect(pushA1.ok).toBe(true);

        const pushB = yield* EventStore.pushEvents([updateB], now);
        expect(pushB.ok).toBe(true);

        const pushA2 = yield* EventStore.pushEvents([updateA], now);
        expect(pushA2.ok).toBe(true);

        // Each device eventually pulls the full log after its own cursor.
        const fromA = yield* EventStore.eventsAfter(0);
        const fromB = yield* EventStore.eventsAfter(0);

        expect(fromA.events.map((e) => e.id)).toEqual(fromB.events.map((e) => e.id));
        expect(fromA.after).toBe(3);

        const foldedA = foldEvents(fromA.events);
        const foldedB = foldEvents([...fromB.events].reverse());

        const taskA = foldedA.tasks.get(TaskId.make(taskId));
        const taskB = foldedB.tasks.get(TaskId.make(taskId));
        expect(taskA).toBeDefined();
        expect(taskB).toBeDefined();
        expect(taskA?.title).toBe("From A again");
        expect(taskB?.title).toBe(taskA?.title);
        expect(taskA?.id).toBe(taskB?.id);
      }),
    ),
  );
});
