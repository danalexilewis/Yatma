// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import type { Event } from "./events.ts";
import { DeviceId, EventId, ProjectId, TaskId } from "./ids.ts";
import {
  dedupeAndSortEvents,
  encodeEvent,
  foldEventLines,
  foldEvents,
  foldTaskEvents,
} from "./fold.ts";

const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };
const projectId = ProjectId.make("p_AAAAAAA1");

function eventId(n: number): EventId {
  return EventId.make(n.toString(32).toUpperCase().replaceAll(/[ILOU]/g, "V").padStart(26, "0"));
}

function envelope(id: number, at: string) {
  return {
    v: 1 as const,
    id: eventId(id),
    at,
    by: user,
  };
}

function projectCreated(id: number, at: string): Event {
  return {
    ...envelope(id, at),
    type: "project.created",
    projectId,
    title: "App",
  };
}

function taskCreated(id: number, taskId: string, at: string, position: string, title = "Task"): Event {
  return {
    ...envelope(id, at),
    type: "task.created",
    taskId: TaskId.make(taskId),
    projectId,
    title,
    status: "todo",
    quadrant: null,
    position,
  };
}

function taskUpdated(
  id: number,
  taskId: string,
  at: string,
  set: { status?: "todo" | "in_progress" | "done"; position?: string; title?: string },
): Event {
  return {
    ...envelope(id, at),
    type: "task.updated",
    taskId: TaskId.make(taskId),
    set,
  };
}

describe("foldEvents", () => {
  it("folds create and update events into task state", () => {
    const events = [
      projectCreated(1, "2026-10-06T00:00:00.000Z"),
      taskCreated(2, "t_AAAAAAA1", "2026-10-06T01:00:00.000Z", "n", "First"),
      taskUpdated(3, "t_AAAAAAA1", "2026-10-06T02:00:00.000Z", {
        status: "in_progress",
        position: "d",
      }),
    ];
    const folded = foldEvents(events);
    expect(folded.projects.get(projectId)?.title).toBe("App");
    const task = folded.tasks.get(TaskId.make("t_AAAAAAA1"));
    expect(task?.title).toBe("First");
    expect(task?.status).toBe("in_progress");
    expect(task?.position).toBe("d");
    expect(task?.completedAt).toBeNull();
  });

  it("dedupes by id and sorts by at then id", () => {
    const laterFirst = [
      taskCreated(2, "t_AAAAAAA1", "2026-10-06T02:00:00.000Z", "t"),
      projectCreated(1, "2026-10-06T00:00:00.000Z"),
      taskCreated(2, "t_AAAAAAA1", "2026-10-06T02:00:00.000Z", "t"),
    ];
    const ordered = dedupeAndSortEvents(laterFirst);
    expect(ordered.map((event) => event.id)).toEqual([eventId(1), eventId(2)]);
    expect(foldEvents(laterFirst).tasks.size).toBe(1);
  });

  it("applies last-write-wins per field across shuffled order", () => {
    const events = [
      taskUpdated(3, "t_AAAAAAA1", "2026-10-06T03:00:00.000Z", { title: "Final" }),
      taskCreated(1, "t_AAAAAAA1", "2026-10-06T01:00:00.000Z", "n", "First"),
      taskUpdated(2, "t_AAAAAAA1", "2026-10-06T02:00:00.000Z", { title: "Middle" }),
      projectCreated(0, "2026-10-06T00:00:00.000Z"),
    ];
    const a = foldEvents(events);
    const b = foldEvents([...events].toReversed());
    expect(a.tasks.get(TaskId.make("t_AAAAAAA1"))?.title).toBe("Final");
    expect(b.tasks.get(TaskId.make("t_AAAAAAA1"))?.title).toBe("Final");
  });

  it("skips invalid lines without repairing them", () => {
    const lines = [
      encodeEvent(projectCreated(1, "2026-10-06T00:00:00.000Z")),
      "{not json",
      encodeEvent(taskCreated(2, "t_AAAAAAA1", "2026-10-06T01:00:00.000Z", "n")),
      '{"v":1,"type":"unknown.event"}\n',
    ];
    const folded = foldEventLines(lines);
    expect(folded.skippedLines).toBe(2);
    expect(folded.tasks.size).toBe(1);
  });

  it("folds task events independently of other families", () => {
    const events = [
      projectCreated(1, "2026-10-06T00:00:00.000Z"),
      taskCreated(2, "t_AAAAAAA1", "2026-10-06T01:00:00.000Z", "n"),
    ];
    expect(foldTaskEvents(events).size).toBe(1);
    expect(foldTaskEvents(events).has(TaskId.make("t_AAAAAAA1"))).toBe(true);
  });
});
