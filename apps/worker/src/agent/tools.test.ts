// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import {
  BatchId,
  ChatId,
  DeviceId,
  EventId,
  TaskId,
  type Event,
} from "@yatma/core";
import * as Effect from "effect/Effect";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as Tools from "./tools.ts";
import { makeCommitHub, makeMutationService } from "../application/mutations.ts";

const DEVICE = { kind: "user" as const, deviceId: DeviceId.make("device_test") };
const CHAT = ChatId.make("c_AGENT001");
const AGENT = { kind: "agent" as const, chatId: CHAT, model: "test-model" };

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
    title: input.title ?? "Existing",
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

describe("agent/tools apply_changes", () => {
  it.effect("scripted apply_changes produces task.created events", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T12:00:00.000Z";
        const batchId = Tools.newBatchId();
        const result = yield* Tools.applyChanges(
          {
            reason: "User asked to add milk",
            ops: [
              {
                op: "create_task",
                title: "Buy oat milk",
                projectId: null,
              },
              {
                op: "create_task",
                title: "Call dentist",
                projectId: null,
              },
            ],
          },
          { actor: AGENT, batchId, nowIso: now },
        );

        expect(Tools.isToolFailure(result)).toBe(false);
        if (Tools.isToolFailure(result)) return;

        expect(result.events).toHaveLength(2);
        expect(result.events.every((event) => event.type === "task.created")).toBe(true);
        expect(result.events.every((event) => event.batch === batchId)).toBe(true);
        expect(result.events.every((event) => event.by.kind === "agent")).toBe(true);
        expect(result.summary).toContain("create_task");

        const folded = yield* EventStore.loadFolded;
        expect(folded.tasks.size).toBe(2);
        const titles = [...folded.tasks.values()].map((task) => task.title).toSorted();
        expect(titles).toEqual(["Buy oat milk", "Call dentist"]);
      }),
    ),
  );

  it.effect("scripted start_task + complete_task update existing task", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T12:00:00.000Z";
        yield* EventStore.pushEvents(
          [
            taskCreated({
              id: ulid("01TOOLSTART0000000000001"),
              taskId: "t_START001",
              at: now,
              title: "Write tests",
            }),
          ],
          now,
        );

        const batchId = Tools.newBatchId();
        const started = yield* Tools.applyChanges(
          {
            reason: "Starting work",
            ops: [{ op: "start_task", taskId: TaskId.make("t_START001") }],
          },
          { actor: AGENT, batchId, nowIso: "2026-10-06T12:01:00.000Z" },
        );
        expect(Tools.isToolFailure(started)).toBe(false);
        if (Tools.isToolFailure(started)) return;
        expect(started.events[0]?.type).toBe("task.updated");

        const doneBatch = Tools.newBatchId();
        const done = yield* Tools.applyChanges(
          {
            reason: "Finished",
            ops: [{ op: "complete_task", taskId: TaskId.make("t_START001") }],
          },
          { actor: AGENT, batchId: doneBatch, nowIso: "2026-10-06T12:02:00.000Z" },
        );
        expect(Tools.isToolFailure(done)).toBe(false);
        if (Tools.isToolFailure(done)) return;

        const folded = yield* EventStore.loadFolded;
        expect(folded.tasks.get(TaskId.make("t_START001"))?.status).toBe("done");
      }),
    ),
  );

  it.effect("list_tasks and search read from EventStore", () =>
    withStore(
      Effect.gen(function* () {
        const now = "2026-10-06T12:00:00.000Z";
        yield* EventStore.pushEvents(
          [
            taskCreated({
              id: ulid("01TOOLLIST00000000000001"),
              taskId: "t_AAAA0001",
              at: now,
              title: "Buy oat milk",
            }),
          ],
          now,
        );

        const listed = yield* Tools.listTasks({ limit: 10 });
        expect(listed.tasks.some((task) => task.title.includes("oat"))).toBe(true);

        const hits = yield* Tools.search({ query: "oat" });
        expect(hits.hits.some((hit) => hit.kind === "task")).toBe(true);
      }),
    ),
  );

  it.effect("mutation-backed undo restores its batch while preserving later edits", () =>
    withStore(
      Effect.gen(function* () {
        const mutations = makeMutationService(yield* makeCommitHub);
        const taskId = TaskId.make("t_ABCD0001");
        const created = yield* mutations.executeBatch({
          actor: DEVICE,
          batchId: BatchId.make("batch_undo_seed"),
          now: "2026-10-06T12:00:00.000Z",
          commands: [{ type: "task.create", taskId, input: { title: "Original", notes: "Keep" } }],
        });
        const edited = yield* mutations.executeBatch({
          actor: DEVICE,
          batchId: BatchId.make("batch_undo_edit"),
          now: "2026-10-06T12:01:00.000Z",
          commands: [{ type: "task.update", input: { taskId, title: "Changed" } }],
        });
        yield* mutations.executeBatch({
          actor: DEVICE,
          batchId: BatchId.make("batch_undo_later"),
          now: "2026-10-06T12:02:00.000Z",
          commands: [{ type: "task.update", input: { taskId, notes: "Later edit" } }],
        });

        const undone = yield* Tools.applyChanges(
          { reason: "Restore the title", ops: [{ op: "undo_batch", batchId: edited.batchId }] },
          {
            actor: AGENT,
            batchId: BatchId.make("batch_undo_result"),
            nowIso: "2026-10-06T12:03:00.000Z",
            mutations,
          },
        );
        expect(Tools.isToolFailure(undone)).toBe(false);
        if (Tools.isToolFailure(undone)) return;
        expect(undone.events).toHaveLength(1);
        expect(undone.events[0]?.batch).toBe(BatchId.make("batch_undo_result"));
        expect(undone.events[0]?.undoes).toBe(edited.batchId);
        expect(undone.events[0]?.seq).toBeDefined();
        const task = (yield* EventStore.loadFolded).tasks.get(taskId);
        expect(task?.title).toBe("Original");
        expect(task?.notes).toBe("Later edit");
        expect(created.events).toHaveLength(1);
      }),
    ),
  );

  it.effect("mutation-backed page write commits one assigned atomic event", () =>
    withStore(
      Effect.gen(function* () {
        const mutations = makeMutationService(yield* makeCommitHub);
        const result = yield* Tools.writePage(
          {
            projectId: null,
            kind: "brief",
            title: "Alpha brief",
            body: "One committed page",
            pinned: true,
            reason: "Create the project brief",
          },
          {
            actor: AGENT,
            batchId: BatchId.make("batch_page_atomic"),
            nowIso: "2026-10-06T12:00:00.000Z",
            mutations,
          },
        );
        expect(Tools.isToolFailure(result)).toBe(false);
        if (Tools.isToolFailure(result)) return;
        expect(result.events).toHaveLength(1);
        expect(result.events[0]?.seq).toBe(1);
        expect(result.events[0]?.batch).toBe(BatchId.make("batch_page_atomic"));
        expect((yield* EventStore.loadFolded).pages.get(result.page.id)?.body).toBe(
          "One committed page",
        );
      }),
    ),
  );
});
