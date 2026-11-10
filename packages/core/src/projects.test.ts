import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { planBatch, stampBatch, type BatchCommand } from "./batch.ts";
import { addCalendarDays, isCalendarDate, localCalendarDate } from "./dates.ts";
import type { Event } from "./events.ts";
import { foldEvents, parseEventLine } from "./fold.ts";
import { DeviceId, EventId, ProjectId, TaskId } from "./ids.ts";
import { MATRIX_QUADRANTS, quadrantLabel } from "./matrix.ts";
import {
  groupTasksByProject,
  legacyHeadingProjectId,
  planProjectConsolidation,
  projectHealth,
} from "./projects.ts";
import { PERSONAL_THREAD_ID, selectThreadHistory } from "./thread.ts";
import { latestWritesFromEvents, planUndo } from "./undo.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("project-test") };
const projectId = ProjectId.make("p_AAAAAAA1");
const taskId = TaskId.make("t_AAAAAAA1");

function commit(commands: readonly BatchCommand[], events: readonly Event[] = []) {
  const planned = planBatch(foldEvents(events), commands, { actor });
  if (Result.isFailure(planned)) throw new Error(planned.failure.message);
  const stamped = stampBatch(planned.success.drafts, {
    now: "2026-10-15T00:00:00.000Z",
    observedMaxAt: events.at(-1)?.at ?? null,
    eventIds: planned.success.drafts.map((_, index) =>
      EventId.make(String(events.length + index + 1).padStart(26, "0")),
    ),
  });
  if (Result.isFailure(stamped)) throw new Error(stamped.failure.message);
  return [...events, ...stamped.success];
}

function reload(events: readonly Event[]) {
  return foldEvents(
    events.map((event) => {
      const parsed = parseEventLine(JSON.stringify(event));
      if (!parsed.ok) throw new Error("Invalid stored event");
      return parsed.event;
    }),
  );
}

describe("projects as the only task grouping", () => {
  it("reuses projects, preserves explicit assignments, and leaves ambiguous tags unassigned", () => {
    const assigned = TaskId.make("t_AAAAAAA2");
    const ambiguous = TaskId.make("t_AAAAAAA3");
    const events = commit([
      { type: "project.create", projectId, input: { title: "Home" } },
      { type: "chat.create", chatId: PERSONAL_THREAD_ID, input: { projectId: null } },
      {
        type: "chat.update",
        input: { chatId: PERSONAL_THREAD_ID, headings: ["HOME", "Work", "Someday"] },
      },
      { type: "task.create", taskId, input: { title: "One tag", tags: ["home"] } },
      {
        type: "task.create",
        taskId: assigned,
        input: { title: "Assigned", projectId, tags: ["Work"] },
      },
      {
        type: "task.create",
        taskId: ambiguous,
        input: { title: "Ambiguous", tags: ["Home", "Work"] },
      },
      { type: "task.update", input: { taskId, status: "done" } },
    ]);
    const before = foldEvents(events);
    const commands = planProjectConsolidation(before, legacyHeadingProjectId);
    const journal = commit(commands, events);
    const migrated = reload(journal);
    expect(migrated.projects.size).toBe(3);
    expect(migrated.tasks.get(taskId)?.projectId).toBe(projectId);
    expect(migrated.tasks.get(assigned)?.projectId).toBe(projectId);
    expect(migrated.tasks.get(ambiguous)?.projectId).toBeNull();
    expect([...migrated.tasks.values()].every((task) => task.tags?.length === 0)).toBe(true);
    expect(migrated.chats.get(PERSONAL_THREAD_ID)?.headings).toEqual([]);
    expect(planProjectConsolidation(migrated, legacyHeadingProjectId)).toEqual([]);
    expect(journal.slice(events.length)).toContainEqual(
      expect.objectContaining({
        type: "task.updated",
        taskId: ambiguous,
        prev: { tags: ["Home", "Work"] },
      }),
    );
    expect(selectThreadHistory(migrated)).toEqual(selectThreadHistory(before));
  });

  it("produces the same project identity offline and duplicate creation cannot erase later properties", () => {
    const id = legacyHeadingProjectId("Home");
    expect(id).toBe(legacyHeadingProjectId(" HOME "));
    const events = commit([
      { type: "project.create", projectId: id, input: { title: "Home" } },
      { type: "project.update", input: { projectId: id, description: "Keep this context" } },
    ]);
    const duplicate: Event = {
      v: 1,
      id: EventId.make("00000000000000000000000003"),
      at: "2026-10-16T00:00:00.000Z",
      by: actor,
      type: "project.created",
      projectId: id,
      title: "HOME",
    };
    expect(reload([...events, duplicate]).projects.get(id)?.description).toBe("Keep this context");
    expect(
      planUndo(
        [events[1]!],
        reload([...events, duplicate]),
        latestWritesFromEvents([...events, duplicate]),
      ).skipped,
    ).toEqual([]);
  });

  it("keeps one global priority within each project and orders groups by their first task", () => {
    const events = commit([
      { type: "project.create", projectId, input: { title: "Home" } },
      { type: "task.create", taskId, input: { title: "Home low", projectId } },
      { type: "task.create", taskId: TaskId.make("t_AAAAAAA2"), input: { title: "Unassigned" } },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA3"),
        input: { title: "Home high", projectId },
      },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA4"),
        input: { title: "Done", projectId },
      },
    ]);
    const state = reload(
      commit(
        [
          {
            type: "task.update",
            input: { taskId: TaskId.make("t_AAAAAAA3"), status: "in_progress" },
          },
          { type: "task.update", input: { taskId: TaskId.make("t_AAAAAAA4"), status: "done" } },
        ],
        events,
      ),
    );
    expect(
      groupTasksByProject([...state.tasks.values()], state.projects).map((group) => [
        group.title,
        group.tasks.map((task) => task.title),
      ]),
    ).toEqual([
      ["Home", ["Home high", "Home low"]],
      ["Unassigned", ["Unassigned"]],
    ]);
  });

  it("round-trips project properties and can undo bookmarks after JSON reload while preserving a later edit", () => {
    const base = commit([{ type: "project.create", projectId, input: { title: "Home" } }]);
    const events = commit(
      [
        {
          type: "project.update",
          input: {
            projectId,
            description: "Make it comfortable",
            targetDate: "2026-12-01",
            bookmarks: [{ title: "Ideas", url: "https://example.com/ideas" }],
          },
        },
      ],
      base,
    );
    const state = reload(events);
    expect(state.projects.get(projectId)).toMatchObject({
      description: "Make it comfortable",
      targetDate: "2026-12-01",
      bookmarks: [{ title: "Ideas", url: "https://example.com/ideas" }],
    });
    const batch = events.slice(base.length);
    expect(planUndo(batch, state, latestWritesFromEvents(events))).toMatchObject({
      skipped: [],
      reverts: [
        { type: "project.updated", set: { description: "", targetDate: null, bookmarks: [] } },
      ],
    });
    const later = commit(
      [{ type: "project.update", input: { projectId, description: "Later purpose" } }],
      events,
    );
    const undo = planUndo(batch, reload(later), latestWritesFromEvents(later));
    expect(undo.skipped).toContainEqual({
      entityId: projectId,
      field: "description",
      reason: "changed_since",
    });
    expect(undo.reverts).toMatchObject([{ set: { targetDate: null, bookmarks: [] } }]);
  });

  it("reports calendar-based health from outstanding work and excludes deleted tasks", () => {
    const events = commit([
      { type: "project.create", projectId, input: { title: "Home" } },
      { type: "task.create", taskId, input: { title: "Late", projectId, dueDate: "2026-10-14" } },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA2"),
        input: { title: "Soon", projectId, dueDate: "2026-10-22" },
      },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA3"),
        input: { title: "Undated", projectId },
      },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA4"),
        input: { title: "Done", projectId, dueDate: "2026-01-01" },
      },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA5"),
        input: { title: "Deleted", projectId, dueDate: "2026-01-01" },
      },
      { type: "task.update", input: { taskId: TaskId.make("t_AAAAAAA5"), deleted: true } },
      { type: "task.update", input: { taskId: TaskId.make("t_AAAAAAA2"), status: "in_progress" } },
      { type: "task.update", input: { taskId: TaskId.make("t_AAAAAAA4"), status: "done" } },
    ]);
    const state = reload(events);
    const health = projectHealth(
      state.projects.get(projectId)!,
      [...state.tasks.values()],
      "2026-10-15",
    );
    expect(health).toMatchObject({
      label: "Needs attention",
      completed: 1,
      total: 4,
      progress: 0.25,
    });
    expect(health.overdue.map((task) => task.title)).toEqual(["Late"]);
    expect(health.dueSoon.map((task) => task.title)).toEqual(["Soon"]);
    expect(health.undated.map((task) => task.title)).toEqual(["Undated"]);
  });
});

describe("calendar dates and matrix compatibility", () => {
  it("rejects impossible dates and handles leap years and year boundaries", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(localCalendarDate(new Date(2026, 9, 15, 23, 59))).toBe("2026-10-15");
    const invalid = planBatch(
      foldEvents([]),
      [{ type: "task.create", taskId, input: { title: "Impossible", dueDate: "2026-02-30" } }],
      { actor },
    );
    expect(Result.isFailure(invalid)).toBe(true);
    const historical = commit([
      { type: "task.create", taskId, input: { title: "Legacy date" } },
    ])[0]!;
    expect(
      parseEventLine(
        JSON.stringify({
          ...historical,
          type: "task.updated",
          taskId,
          set: { dueDate: "2026-02-30" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("keeps user priority when urgency or importance changes", () => {
    const base = commit([
      { type: "task.create", taskId, input: { title: "First" } },
      { type: "task.create", taskId: TaskId.make("t_AAAAAAA2"), input: { title: "Second" } },
    ]);
    const before = foldEvents(base).tasks.get(taskId)!.position;
    const after = commit([{ type: "task.update", input: { taskId, quadrant: "delegate" } }], base);
    expect(foldEvents(after).tasks.get(taskId)!.position).toBe(before);
  });

  it("represents all four combinations while preserving existing stored quadrant keys", () => {
    expect(MATRIX_QUADRANTS.map((entry) => [entry.key, entry.urgent, entry.important])).toEqual([
      ["do", true, true],
      ["schedule", false, true],
      ["delegate", true, false],
      ["eliminate", false, false],
    ]);
    expect(quadrantLabel("delegate")).toBe("Urgent, not important");
    expect(quadrantLabel(null)).toBe("Unsorted");
  });
});
