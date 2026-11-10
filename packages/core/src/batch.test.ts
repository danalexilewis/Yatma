// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";

import { planBatch, stampBatch } from "./batch.ts";
import { BatchId, DeviceId, EventId, ProjectId, TaskId } from "./ids.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("device-a") };
const empty = { projects: new Map(), tasks: new Map(), pages: new Map(), chats: new Map() };
function eventId(n: number): EventId {
  return EventId.make(n.toString(32).toUpperCase().replaceAll(/[ILOU]/g, "V").padStart(26, "0"));
}

describe("planBatch and stampBatch", () => {
  it("returns no writable drafts when a later command is invalid", () => {
    const result = planBatch(empty, [
      { type: "task.create", taskId: TaskId.make("t_AAAAAAA1"), input: { title: "Valid" } },
      { type: "task.update", input: { taskId: TaskId.make("t_BBBBBBB2"), title: "Missing" } },
    ], { actor });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("stages repeated writes and omits no-op commands", () => {
    const taskId = TaskId.make("t_AAAAAAA1");
    const result = planBatch(empty, [
      { type: "task.create", taskId, input: { title: "First" } },
      { type: "task.update", input: { taskId, title: "Second", notes: "memo" } },
      { type: "task.update", input: { taskId, title: "Second" } },
    ], { actor, batchId: BatchId.make("batch-a") });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success.drafts).toHaveLength(2);
    expect(result.success.noops).toEqual([{ commandIndex: 2, reason: "unchanged" }]);
    expect(result.success.finalSnapshot.tasks.get(taskId)).toMatchObject({ title: "Second", notes: "memo" });
    const stamped = stampBatch(result.success.drafts, {
      observedMaxAt: "2026-10-15T12:00:00.000Z",
      now: "2026-10-15T11:00:00.000Z",
      eventIds: [eventId(1), eventId(2)],
    });
    expect(Result.isSuccess(stamped)).toBe(true);
    if (Result.isSuccess(stamped)) expect(stamped.success.map((event) => event.at)).toEqual([
      "2026-10-15T12:00:00.001Z",
      "2026-10-15T12:00:00.002Z",
    ]);
  });

  it("emits no events for an empty batch and validates clock values", () => {
    const emptyPlan = planBatch(empty, [], { actor });
    expect(Result.isSuccess(emptyPlan) && emptyPlan.success.drafts).toEqual([]);
    const stamp = stampBatch([], { now: "tomorrow", eventIds: [] });
    expect(Result.isFailure(stamp)).toBe(true);
    const badProjectReference = planBatch(empty, [{ type: "task.create", taskId: TaskId.make("t_AAAAAAA1"), input: { title: "X", projectId: ProjectId.make("p_AAAAAAA1") } }], { actor });
    expect(Result.isFailure(badProjectReference)).toBe(true);
  });
});
