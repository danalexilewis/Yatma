import { describe, expect, it } from "@effect/vitest";
import { BatchId, DeviceId, EventId, InternalError, TaskId, generateEventId, type Event } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import { makeCommitHub, makeMutationService } from "./mutations.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("writer-device") };
const batchId = BatchId.make("batch_writer_test");
const now = "2026-10-15T12:00:00.000Z";

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  EventStore.migrate.pipe(
    Effect.andThen(effect),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );

describe("Worker mutation service", () => {
  it.effect("checks the account lifecycle fence inside the serialized writer", () =>
    withStore(
      Effect.gen(function* () {
        const hub = yield* makeCommitHub;
        const service = makeMutationService(hub, () =>
          Effect.fail(new InternalError({ message: "account_deletion_in_progress" })),
        );
        const result = yield* Effect.exit(service.executeBatch({
          actor,
          batchId,
          now,
          commands: [{ type: "task.create", taskId: TaskId.make("t_DE1E7E01"), input: { title: "blocked" } }],
        }));
        expect(result._tag).toBe("Failure");
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(0);
      }),
    ),
  );

  it.effect("rejects an invalid second command without writing the first", () =>
    withStore(
      Effect.gen(function* () {
        const hub = yield* makeCommitHub;
        const service = makeMutationService(hub);
        const result = yield* Effect.exit(
          service.executeBatch({
            actor,
            batchId,
            now,
            commands: [
              { type: "task.create", taskId: TaskId.make("t_WR1TER01"), input: { title: "valid" } },
              {
                type: "task.update",
                input: { taskId: TaskId.make("t_M1SS1NG1"), title: "missing" },
              },
            ],
          }),
        );
        expect(result._tag).toBe("Failure");
        expect((yield* EventStore.eventsAfter(0)).events).toHaveLength(0);
        expect(yield* EventStore.getEntity("t_WR1TER01")).toBeNull();
        expect(yield* EventStore.searchFts("valid")).toHaveLength(0);
      }),
    ),
  );

  it.effect(
    "stamps and commits the staged batch, then publishes committed sequence assignments",
    () =>
      withStore(
        Effect.scoped(
          Effect.gen(function* () {
            const hub = yield* makeCommitHub;
            const service = makeMutationService(hub);
            const live = yield* hub.subscribe;
            const observedFiber = yield* Effect.forkChild(Stream.runHead(live));
            const taskId = TaskId.make("t_WR1TER02");
            const result = yield* service.executeBatch({
              actor,
              batchId,
              now,
              commands: [
                { type: "task.create", taskId, input: { title: "first" } },
                { type: "task.update", input: { taskId, title: "second" } },
              ],
            });
            const notification = Option.getOrThrow(yield* Fiber.join(observedFiber));
            expect(result.batchId).toBe(batchId);
            expect(result.events.map((event) => event.seq)).toEqual([1, 2]);
            expect(Date.parse(result.events[0]?.at ?? "")).toBeLessThan(
              Date.parse(result.events[1]?.at ?? ""),
            );
            expect(result.snapshot.tasks.get(taskId)?.title).toBe("second");
            expect(notification.batchId).toBe(batchId);
            expect(notification.events.map((event) => event.id)).toEqual(
              result.events.map((event) => event.id),
            );
            expect((yield* EventStore.eventsAfter(0)).events.map((event) => event.id)).toEqual(
              result.events.map((event) => event.id),
            );
          }),
        ),
      ),
  );

  it.effect("registers before catch-up and delivers commits without a cursor gap", () =>
    withStore(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* makeCommitHub;
          const service = makeMutationService(hub);
          const live = service
            .observeAfter(0)
            .pipe(Stream.filter((batch) => batch.events.length > 0));
          const observer = yield* Effect.forkChild(Stream.runHead(live));
          const event: Event = {
            v: 1,
            type: "task.created",
            id: EventId.make("01J9X1M2N3P4Q5R6S7T8V9WXYZ"),
            at: now,
            by: actor,
            taskId: TaskId.make("t_0B5ERVE1"),
            projectId: null,
            title: "arrives during catch-up",
            status: "todo",
            quadrant: null,
            position: "n",
          };
          const pushed = yield* service.pushIncomingBatch([event], now);
          expect(pushed.ok).toBe(true);
          const observed = Option.getOrThrow(yield* Fiber.join(observer));
          expect(observed.events.map((item) => item.id)).toEqual([event.id]);
          expect(observed.after).toBe(1);
        }),
      ),
    ),
  );

  it.effect("stamps against the latest actual event time across timezone offsets", () =>
    withStore(
      Effect.gen(function* () {
        const hub = yield* makeCommitHub;
        const service = makeMutationService(hub);
        const earlier: Event = {
          v: 1,
          type: "task.created",
          id: generateEventId(),
          at: "2026-10-15T13:00:00+02:00",
          by: actor,
          taskId: TaskId.make("t_TZE0R1Y1"),
          projectId: null,
          title: "earlier instant",
          status: "todo",
          quadrant: null,
          position: "n",
        };
        const latest: Event = {
          ...earlier,
          id: generateEventId(),
          at: "2026-10-15T10:00:00-02:00",
          taskId: TaskId.make("t_TZB7ER01"),
          title: "latest instant",
        };
        const pushed = yield* service.pushIncomingBatch([earlier, latest], "2026-10-15T11:30:00Z");
        expect(pushed.ok).toBe(true);
        const result = yield* service.executeBatch({
          actor,
          batchId,
          now: "2026-10-15T11:30:00Z",
          commands: [
            {
              type: "task.create",
              taskId: TaskId.make("t_TZSTAMP1"),
              input: { title: "ordered after both" },
            },
          ],
        });
        expect(result.events[0]?.at).toBe("2026-10-15T12:00:00.001Z");
      }),
    ),
  );
});
