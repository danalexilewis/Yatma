import {
  DeviceId,
  EventId,
  ProjectId,
  TaskId,
  foldEvents,
  formatRef,
  type Event,
  type FoldedEntities,
} from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import {
  findMentionQuery,
  insertMention,
  selectMentionSuggestions,
  selectionAfterTextChange,
} from "./mentions";

const taskId = TaskId.make("t_AAAAAAA1");
const duplicateId = TaskId.make("t_AAAAAAA2");
const deletedId = TaskId.make("t_AAAAAAA3");
const projectId = ProjectId.make("p_AAAAAAA1");
const archivedId = ProjectId.make("p_AAAAAAA2");
const title = "Review [draft] \\ notes";
function fixture() {
  let sequence = 0;
  function envelope() {
    return {
      v: 1 as const,
      id: EventId.make(String(++sequence).padStart(26, "0")),
      at: "2026-11-11T00:00:00.000Z",
      by: { kind: "user" as const, deviceId: DeviceId.make("mentions-test") },
    };
  }
  const events: Event[] = [
    { ...envelope(), type: "project.created", projectId, title: "Website [launch]" },
    { ...envelope(), type: "project.created", projectId: archivedId, title: "Archive" },
    { ...envelope(), type: "project.updated", projectId: archivedId, set: { archived: true } },
    {
      ...envelope(),
      type: "task.created",
      taskId,
      projectId,
      title,
      status: "todo",
      quadrant: null,
      position: "b",
    },
    {
      ...envelope(),
      type: "task.created",
      taskId: duplicateId,
      projectId: null,
      title,
      status: "in_progress",
      quadrant: null,
      position: "d",
    },
    {
      ...envelope(),
      type: "task.created",
      taskId: deletedId,
      projectId: null,
      title: "Deleted draft",
      status: "todo",
      quadrant: null,
      position: "f",
    },
    { ...envelope(), type: "task.updated", taskId: deletedId, set: { deleted: true } },
  ];
  return foldEvents(events);
}
function query(text: string) {
  const result = findMentionQuery(text, { start: text.length, end: text.length });
  if (!result) throw new Error("Expected mention query");
  return result;
}

describe("conversation mentions", () => {
  it("detects typed task/project queries at the caret, including middle-of-draft insertion", () => {
    expect(query("Discuss @task Review")).toMatchObject({
      start: 8,
      kind: "task",
      query: "Review",
    });
    expect(query("@project:Web")).toMatchObject({ kind: "project", query: "Web" });
    expect(query("@task")).toMatchObject({ kind: "task", query: "" });
    expect(query("@")).toMatchObject({ kind: null, query: "" });
    expect(findMentionQuery("Plan @task Review tomorrow", { start: 17, end: 17 })).toMatchObject({
      kind: "task",
      query: "Review",
    });
  });

  it("does not open suggestions inside email, existing markdown links, selected text, or another line", () => {
    for (const text of [
      "person@example.test",
      "[Review @task](task:t_AAAAAAA1)",
      "@task Draft\nthen plan",
      "@task [draft]",
    ]) {
      expect(findMentionQuery(text, { start: text.length, end: text.length })).toBeNull();
    }
    expect(findMentionQuery("@task Draft", { start: 0, end: 11 })).toBeNull();
    expect(findMentionQuery("[Review @task](task:t_AAAAAAA1)", { start: 13, end: 13 })).toBeNull();
  });

  it("disambiguates duplicate titles with committed IDs, status and project context", () => {
    const suggestions = selectMentionSuggestions(fixture(), query("@task Review"));
    expect(suggestions.map((item) => item.id)).toEqual([taskId, duplicateId]);
    expect(suggestions[0]?.context).toContain("Website [launch] · To do · t_AAAAAAA1");
    expect(suggestions[1]?.context).toContain("No project · In progress · t_AAAAAAA2");
    expect(
      selectMentionSuggestions(fixture(), query("@task AAAAAAA2")).map((item) => item.id),
    ).toEqual([duplicateId]);
    expect(selectMentionSuggestions(fixture(), query("@project")).map((item) => item.id)).toEqual([
      projectId,
    ]);
    expect(
      selectMentionSuggestions(fixture(), query("@")).some(
        (item) => item.id === deletedId || item.id === archivedId,
      ),
    ).toBe(false);
  });

  it("inserts escaped durable IDs while preserving surrounding text and the new caret", () => {
    const state = fixture();
    const text = "Plan @task Review tomorrow";
    const mention = findMentionQuery(text, { start: 17, end: 17 })!;
    const suggestion = selectMentionSuggestions(state, mention)[0]!;
    const inserted = insertMention(text, mention, suggestion, state)!;
    const prefix = `Plan ${formatRef("task", taskId, title)}`;
    expect(inserted).toEqual({
      text: `${prefix} tomorrow`,
      selection: { start: prefix.length, end: prefix.length },
    });
    const projectMention = query("Ask @project Web");
    expect(
      insertMention(
        "Ask @project Web",
        projectMention,
        selectMentionSuggestions(state, projectMention)[0]!,
        state,
      )?.text,
    ).toBe(`Ask ${formatRef("project", projectId, "Website [launch]")} `);
  });

  it("rejects deleted/archived suggestions and changed queries; a rename uses the same current ID", () => {
    const state = fixture();
    const text = "@task Review";
    const mention = query(text);
    const suggestion = selectMentionSuggestions(state, mention)[0]!;
    const renamed: FoldedEntities = {
      ...state,
      tasks: new Map(state.tasks).set(taskId, {
        ...state.tasks.get(taskId)!,
        title: "Current title",
      }),
    };
    expect(insertMention(text, mention, suggestion, renamed)?.text).toBe(
      "[Current title](task:t_AAAAAAA1) ",
    );
    const deleted: FoldedEntities = {
      ...state,
      tasks: new Map(state.tasks).set(taskId, {
        ...state.tasks.get(taskId)!,
        deletedAt: "2026-11-11T01:00:00.000Z",
      }),
    };
    expect(insertMention(text, mention, suggestion, deleted)).toBeNull();
    expect(insertMention("@task Changed", mention, suggestion, state)).toBeNull();
    const projectMention = query("@project Web");
    const projectSuggestion = selectMentionSuggestions(state, projectMention)[0]!;
    const archived: FoldedEntities = {
      ...state,
      projects: new Map(state.projects).set(projectId, {
        ...state.projects.get(projectId)!,
        archivedAt: "2026-11-11T01:00:00.000Z",
      }),
    };
    expect(insertMention("@project Web", projectMention, projectSuggestion, archived)).toBeNull();
  });

  it("preserves the caret through middle edits, deletion, and selected-text replacement", () => {
    expect(selectionAfterTextChange("aaaa", "aaaaa", { start: 2, end: 2 })).toEqual({
      start: 3,
      end: 3,
    });
    expect(
      selectionAfterTextChange("Plan task next", "Plan @task next", { start: 5, end: 5 }),
    ).toEqual({ start: 6, end: 6 });
    expect(
      selectionAfterTextChange("Plan @task next", "Plan task next", { start: 6, end: 6 }),
    ).toEqual({ start: 5, end: 5 });
    expect(
      selectionAfterTextChange("Plan @task next", "Plan task next", { start: 5, end: 5 }),
    ).toEqual({ start: 5, end: 5 });
    expect(selectionAfterTextChange("Plan old task", "Plan @task", { start: 5, end: 13 })).toEqual({
      start: 10,
      end: 10,
    });
  });
});
