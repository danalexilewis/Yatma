// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import type { Event } from "./events.ts";
import { BatchId, DeviceId, EventId, ProjectId, TaskId } from "./ids.ts";
import { foldEvents } from "./fold.ts";
import type { Task } from "./schemas.ts";
import { planUndo } from "./undo.ts";

const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };
const projectId = ProjectId.make("p_AAAAAAA1");
const taskId = TaskId.make("t_AAAAAAA1");

function eventId(n: number): EventId {
  return EventId.make(n.toString(32).toUpperCase().replaceAll(/[ILOU]/g, "V").padStart(26, "0"));
}

function envelope(id: number, at: string, batch?: string) {
  return {
    v: 1 as const,
    id: eventId(id),
    at,
    by: user,
    ...(batch !== undefined ? { batch: BatchId.make(batch) } : {}),
  };
}

function seedTask(title = "Original"): { readonly events: Event[]; readonly task: Task } {
  const events: Event[] = [
    {
      ...envelope(0, "2026-10-06T00:00:00.000Z"),
      type: "project.created",
      projectId,
      title: "App",
    },
    {
      ...envelope(1, "2026-10-06T01:00:00.000Z"),
      type: "task.created",
      taskId,
      projectId,
      title,
      status: "todo",
      quadrant: null,
      position: "n",
    },
  ];
  const folded = foldEvents(events);
  return { events, task: folded.tasks.get(taskId)! };
}

describe("planUndo", () => {
  it("reverts fields that still hold the batch values", () => {
    const { task } = seedTask("Original");
    const batch: Event[] = [
      {
        ...envelope(2, "2026-10-06T02:00:00.000Z", "batch1"),
        type: "task.updated",
        taskId,
        set: { title: "Changed" },
        prev: { title: "Original" },
      },
    ];
    const current = {
      projects: new Map(),
      tasks: new Map([[taskId, { ...task, title: "Changed", updatedAt: "2026-10-06T02:00:00.000Z" }]]),
      pages: new Map(),
      chats: new Map(),
    };
    const plan = planUndo(batch, current);
    expect(plan.reverts).toEqual([
      { type: "task.updated", taskId, set: { title: "Original" } },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips fields changed since the batch", () => {
    const { task } = seedTask("Original");
    const batch: Event[] = [
      {
        ...envelope(2, "2026-10-06T02:00:00.000Z", "batch1"),
        type: "task.updated",
        taskId,
        set: { title: "Changed" },
        prev: { title: "Original" },
      },
    ];
    const current = {
      projects: new Map(),
      tasks: new Map([[taskId, { ...task, title: "Edited later" }]]),
      pages: new Map(),
      chats: new Map(),
    };
    const plan = planUndo(batch, current);
    expect(plan.reverts).toEqual([]);
    expect(plan.skipped).toEqual([
      { entityId: taskId, field: "title", reason: "changed_since" },
    ]);
  });

  it("soft-deletes entities created by the batch", () => {
    const batch: Event[] = [
      {
        ...envelope(2, "2026-10-06T02:00:00.000Z", "batch1"),
        type: "task.created",
        taskId,
        projectId,
        title: "New",
        status: "todo",
        quadrant: null,
        position: "t",
      },
    ];
    const task: Task = {
      id: taskId,
      projectId,
      title: "New",
      notes: "",
      dueDate: null,
      status: "todo",
      quadrant: null,
      position: "t",
      createdAt: "2026-10-06T02:00:00.000Z",
      createdBy: user,
      updatedAt: "2026-10-06T02:00:00.000Z",
      completedAt: null,
      deletedAt: null,
      lastReason: null,
    };
    const plan = planUndo(batch, {
      projects: new Map(),
      tasks: new Map([[taskId, task]]),
      pages: new Map(),
      chats: new Map(),
    });
    expect(plan.reverts).toEqual([
      {
        type: "task.updated",
        taskId,
        set: { deleted: true },
        fromCreate: true,
      },
    ]);
  });
});
