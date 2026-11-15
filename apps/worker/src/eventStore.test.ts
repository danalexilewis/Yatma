// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import { DeviceId, EventId, TaskId, type Event } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

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
  it.effect(
    "projects daily entities, intervals, templates, and preferences in one retry-safe commit",
    () =>
      withStore(
        Effect.gen(function* () {
          const at = "2026-11-10T00:00:00.000Z";
          const base = { v: 1 as const, at, by: DEVICE };
          const events: readonly Event[] = [
            {
              ...base,
              id: EventId.make(ulid("DAY1")),
              type: "day.created",
              day: {
                id: "day-a",
                date: "2026-11-10",
                timezone: "Pacific/Auckland",
                assembled: true,
                suppressedBreakOrigins: [],
                createdAt: at,
                updatedAt: at,
              },
            },
            {
              ...base,
              id: EventId.make(ulid("DAY2")),
              type: "dayEntry.created",
              entry: {
                id: "entry-a",
                dayId: "day-a",
                kind: "activity",
                taskId: null,
                title: "Daily activity",
                allocationMinutes: 10,
                position: "a",
                status: "pending",
                origin: "manual:entry-a",
                manual: true,
                carryOrder: null,
                preparation: false,
                resumeEntryId: null,
                createdAt: at,
                updatedAt: at,
              },
            },
            {
              ...base,
              id: EventId.make(ulid("DAY3")),
              type: "workInterval.created",
              interval: {
                id: "interval-a",
                dayId: "day-a",
                entryId: "entry-a",
                deviceId: DEVICE.deviceId,
                startedAt: at,
                endedAt: null,
                correctedSeconds: null,
                updatedAt: at,
              },
            },
            {
              ...base,
              id: EventId.make(ulid("DAY4")),
              type: "stackTemplate.saved",
              template: { id: "routine-a", version: 1, title: "Routine", items: [], updatedAt: at },
            },
            {
              ...base,
              id: EventId.make(ulid("DAY5")),
              type: "stackPreferences.updated",
              set: { scene: "rain", workIntervalMinutes: 90 },
            },
          ];
          const pushed = yield* EventStore.pushEvents(events, at);
          expect(pushed.ok).toBe(true);
          const retry = yield* EventStore.pushEvents(events, at);
          expect(retry.ok && retry.result.accepted).toEqual([]);
          expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(5);
          expect((yield* EventStore.getEntity("day-a"))?.kind).toBe("day");
          expect((yield* EventStore.getEntity("entry-a"))?.kind).toBe("dayEntry");
          expect((yield* EventStore.getEntity("interval-a"))?.kind).toBe("workInterval");
          expect((yield* EventStore.getEntity("routine-a"))?.kind).toBe("stackTemplate");
          expect((yield* EventStore.getEntity("default"))?.state).toMatchObject({ scene: "rain" });
          expect(yield* EventStore.searchFts("Daily")).toHaveLength(0);
        }),
      ),
  );

  it.effect("updates linked entry and interval projections atomically when a task completes", () =>
    withStore(
      Effect.gen(function* () {
        const at = "2026-11-10T00:00:00.000Z";
        const stop = "2026-11-10T00:10:00.000Z";
        const task = taskCreated({ id: ulid("TASKCREATE"), taskId: "t_ABCDEFGH", at });
        const base = { v: 1 as const, at, by: DEVICE };
        const records: readonly Event[] = [
          task,
          {
            ...base,
            id: EventId.make(ulid("ENTRYCREATE")),
            type: "dayEntry.created",
            entry: {
              id: "entry-task",
              dayId: "day-a",
              kind: "task",
              taskId: TaskId.make("t_ABCDEFGH"),
              title: "Task work",
              allocationMinutes: 30,
              position: "a",
              status: "pending",
              origin: "task:t_ABCDEFGH",
              manual: false,
              carryOrder: null,
              preparation: false,
              resumeEntryId: null,
              createdAt: at,
              updatedAt: at,
            },
          },
          {
            ...base,
            id: EventId.make(ulid("INTERVALCREATE")),
            type: "workInterval.created",
            interval: {
              id: "interval-task",
              entryId: "entry-task",
              dayId: "day-a",
              deviceId: DEVICE.deviceId,
              startedAt: at,
              endedAt: null,
              correctedSeconds: null,
              updatedAt: at,
            },
          },
        ];
        yield* EventStore.pushEvents(records, at);
        yield* EventStore.pushEvents(
          [
            {
              ...base,
              id: EventId.make(ulid("TASKDONE")),
              at: stop,
              type: "task.updated",
              taskId: TaskId.make("t_ABCDEFGH"),
              set: { status: "done" },
            },
          ],
          stop,
        );
        expect((yield* EventStore.getEntity("entry-task"))?.state).toMatchObject({
          status: "done",
        });
        expect((yield* EventStore.getEntity("interval-task"))?.state).toMatchObject({
          endedAt: stop,
        });
      }),
    ),
  );

  it.effect("rolls back daily journal and projection writes together on failure", () =>
    withStore(
      Effect.gen(function* () {
        const at = "2026-11-10T00:00:00.000Z";
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe(`CREATE TRIGGER fail_daily_projection BEFORE INSERT ON entities
          WHEN NEW.kind = 'dayEntry'
          BEGIN SELECT RAISE(ABORT, 'injected daily projection failure'); END`);
        const base = { v: 1 as const, at, by: DEVICE };
        const events: readonly Event[] = [
          {
            ...base,
            id: EventId.make(ulid("FAILDAY")),
            type: "day.created",
            day: {
              id: "day-a",
              date: "2026-11-10",
              timezone: "Pacific/Auckland",
              assembled: true,
              suppressedBreakOrigins: [],
              createdAt: at,
              updatedAt: at,
            },
          },
          {
            ...base,
            id: EventId.make(ulid("FAILENTRY")),
            type: "dayEntry.created",
            entry: {
              id: "entry-a",
              dayId: "day-a",
              kind: "activity",
              taskId: null,
              title: "Activity",
              allocationMinutes: 10,
              position: "a",
              status: "pending",
              origin: "manual:entry-a",
              manual: true,
              carryOrder: null,
              preparation: false,
              resumeEntryId: null,
              createdAt: at,
              updatedAt: at,
            },
          },
        ];
        const result = yield* Effect.exit(EventStore.pushEvents(events, at));
        expect(result._tag).toBe("Failure");
        expect((yield* EventStore.eventsAfter(0)).events).toEqual([]);
        expect(yield* EventStore.getEntity("day-a")).toBeNull();
        expect(yield* EventStore.getEntity("entry-a")).toBeNull();
        yield* sql.unsafe("DROP TRIGGER fail_daily_projection");
        const retried = yield* EventStore.pushEvents(events, at);
        expect(retried.ok).toBe(true);
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(2);
      }),
    ),
  );

  it.effect("fails catch-up rather than skipping an unsupported stored event", () =>
    withStore(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const payload = JSON.stringify({ type: "future.created", id: ulid("FUTURE") });
        yield* sql`INSERT INTO events (id, entity_id, at, payload) VALUES ('future-id', 'future-entity', '2026-11-10T00:00:00.000Z', ${payload})`;
        const result = yield* Effect.exit(EventStore.eventsAfter(0));
        expect(result._tag).toBe("Failure");
      }),
    ),
  );

  it.effect("retry returns original sequence assignments for every duplicate id", () =>
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
        expect(second.result.assigned).toEqual([{ id: event.id, seq: 1 }]);
      }),
    ),
  );

  it.effect("prevalidates the complete batch before writing", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const valid = taskCreated({
          id: ulid("01PREVALIDATE000000000001"),
          taskId: "t_ABCDEFG1",
          at: now,
        });
        const invalid = { ...valid, id: "bad-id" };
        const result = yield* EventStore.pushEvents([valid, invalid], now);
        expect(result.ok).toBe(false);
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(0);
        expect(yield* EventStore.getEntity("t_ABCDEFG1")).toBeNull();
        expect(yield* EventStore.searchFts("milk")).toHaveLength(0);
      }),
    ),
  );

  it.effect("rejects conflicting historical content without changing prior history", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T00:00:00.000Z";
        const original = taskCreated({
          id: ulid("01CONFLICTEVENT00000000001"),
          taskId: "t_BCDEFGH1",
          at: now,
        });
        yield* EventStore.pushEvents([original], now);
        const changed = { ...original, title: "Changed content" };
        const result = yield* EventStore.pushEvents(
          [
            taskCreated({
              id: ulid("01CONFLICTNEW000000000001"),
              taskId: "t_CDEFGH01",
              at: now,
            }),
            changed,
          ],
          now,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reject._tag).toBe("event_conflict");
        expect((yield* EventStore.eventsAfter(0)).events.map((event) => event.id)).toEqual([
          original.id,
        ]);
        expect(yield* EventStore.getEntity("t_CDEFGH01")).toBeNull();
      }),
    ),
  );

  it.effect("rolls back event append when FTS update fails", () =>
    withStore(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-10-06T00:00:00.000Z";
        const event = taskCreated({
          id: ulid("01ROLLBACKFTS000000000001"),
          taskId: "t_DEFGH012",
          at: now,
        });
        yield* sql.unsafe("DROP TABLE search_fts");
        const exit = yield* Effect.exit(EventStore.pushEvents([event], now));
        expect(exit._tag).toBe("Failure");
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(0);
        expect(yield* EventStore.getEntity("t_DEFGH012")).toBeNull();
      }),
    ),
  );

  it.effect("rolls back event append when projection update fails", () =>
    withStore(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-10-06T00:00:00.000Z";
        const event = taskCreated({
          id: ulid("01ROLLBACKPROJECTION000001"),
          taskId: "t_EFGH0123",
          at: now,
        });
        yield* sql.unsafe(`CREATE TRIGGER fail_projection BEFORE INSERT ON entities
          BEGIN SELECT RAISE(ABORT, 'projection failed'); END`);
        const exit = yield* Effect.exit(EventStore.pushEvents([event], now));
        expect(exit._tag).toBe("Failure");
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(0);
        expect(yield* EventStore.getEntity("t_EFGH0123")).toBeNull();
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
