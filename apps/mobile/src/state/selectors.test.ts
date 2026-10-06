import type { Event, FoldedEntities } from "@yatma/core";
import { DeviceId, EventId, foldEvents, ProjectId, TaskId } from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import {
  selectInboxTasks,
  selectNowTasks,
  selectProjectTasks,
  selectQuadrantTasks,
  selectTaskHistory,
} from "./selectors";

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

function sampleFolded(): FoldedEntities {
  const events: Event[] = [
    {
      ...envelope(1, "2026-10-06T00:00:00.000Z"),
      type: "project.created",
      projectId,
      title: "App",
    },
    {
      ...envelope(2, "2026-10-06T01:00:00.000Z"),
      type: "task.created",
      taskId: TaskId.make("t_AAAAAAA1"),
      projectId,
      title: "Inbox item",
      status: "todo",
      quadrant: null,
      position: "d",
    },
    {
      ...envelope(3, "2026-10-06T01:30:00.000Z"),
      type: "task.created",
      taskId: TaskId.make("t_AAAAAAA2"),
      projectId,
      title: "Do item",
      status: "todo",
      quadrant: "do",
      position: "m",
    },
    {
      ...envelope(4, "2026-10-06T02:00:00.000Z"),
      type: "task.updated",
      taskId: TaskId.make("t_AAAAAAA2"),
      set: { title: "Do item renamed" },
    },
    {
      ...envelope(5, "2026-10-06T03:00:00.000Z"),
      type: "task.created",
      taskId: TaskId.make("t_AAAAAAA3"),
      projectId: null,
      title: "Done already",
      status: "done",
      quadrant: null,
      position: "t",
    },
  ];
  return foldEvents(events);
}

describe("mobile selectors", () => {
  it("selectNowTasks returns open tasks in position order", () => {
    const now = selectNowTasks(sampleFolded());
    expect(now.map((task) => task.id)).toEqual([
      TaskId.make("t_AAAAAAA1"),
      TaskId.make("t_AAAAAAA2"),
    ]);
  });

  it("selectInboxTasks and selectQuadrantTasks split triage buckets", () => {
    const folded = sampleFolded();
    expect(selectInboxTasks(folded).map((task) => task.id)).toEqual([
      TaskId.make("t_AAAAAAA1"),
    ]);
    expect(selectQuadrantTasks(folded, "do").map((task) => task.id)).toEqual([
      TaskId.make("t_AAAAAAA2"),
    ]);
  });

  it("selectProjectTasks scopes open tasks to a project", () => {
    const folded = sampleFolded();
    expect(selectProjectTasks(folded, projectId).map((task) => task.title)).toEqual([
      "Inbox item",
      "Do item renamed",
    ]);
  });

  it("selectTaskHistory returns newest-first events for a task", () => {
    const history = selectTaskHistory(sampleFolded(), "t_AAAAAAA2");
    expect(history.map((event) => event.type)).toEqual(["task.updated", "task.created"]);
  });
});
