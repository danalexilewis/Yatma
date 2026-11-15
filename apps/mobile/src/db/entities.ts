import type {
  Chat,
  ChatId,
  Event,
  FoldedEntities,
  Page,
  PageId,
  Project,
  ProjectId,
  Task,
  TaskId,
  Day,
  DayEntry,
  WorkInterval,
  StackTemplate,
  StackPreferences,
  ReviewItem,
} from "@yatma/core";
import { dedupeAndSortEvents } from "@yatma/core";

export type EntityKind =
  | "project"
  | "task"
  | "page"
  | "chat"
  | "day"
  | "dayEntry"
  | "workInterval"
  | "stackTemplate"
  | "stackPreferences"
  | "review";

export type CachedEntityMaps = {
  readonly reviewItems: Map<string, ReviewItem>;
  readonly projects: Map<ProjectId, Project>;
  readonly tasks: Map<TaskId, Task>;
  readonly pages: Map<PageId, Page>;
  readonly chats: Map<ChatId, Chat>;
  readonly days: Map<string, Day>;
  readonly dayEntries: Map<string, DayEntry>;
  readonly workIntervals: Map<string, WorkInterval>;
  readonly stackTemplates: Map<string, StackTemplate>;
  readonly stackPreferences: Map<string, StackPreferences>;
};

/** Kind of the entity an event mutates. */
export function entityKindOf(event: Event): EntityKind {
  const kind = event.type.split(".")[0];
  if (
    kind === "review" ||
    kind === "project" ||
    kind === "task" ||
    kind === "page" ||
    kind === "chat" ||
    kind === "day" ||
    kind === "dayEntry" ||
    kind === "workInterval" ||
    kind === "stackTemplate" ||
    kind === "stackPreferences"
  ) {
    return kind;
  }
  throw new Error(`Unsupported entity kind: ${kind}`);
}

/** Entity id an event mutates. */
export function entityIdOf(event: Event): string {
  switch (event.type) {
    case "review.received":
      return event.item.id;
    case "review.updated":
      return event.itemId;
    case "project.created":
    case "project.updated":
      return event.projectId;
    case "task.created":
    case "task.updated":
      return event.taskId;
    case "page.created":
    case "page.updated":
      return event.pageId;
    case "chat.created":
    case "chat.message":
    case "chat.updated":
      return event.chatId;
    case "day.created":
      return event.day.id;
    case "day.updated":
      return event.dayId;
    case "dayEntry.created":
      return event.entry.id;
    case "dayEntry.updated":
      return event.entryId;
    case "workInterval.created":
      return event.interval.id;
    case "workInterval.updated":
      return event.intervalId;
    case "stackTemplate.saved":
      return event.template.id;
    case "stackPreferences.updated":
      return "default";
  }
}

/** Build FoldedEntities from a cache hit, attaching the event log for history. */
export function foldedFromCache(cache: CachedEntityMaps, events: readonly Event[]): FoldedEntities {
  return {
    reviewItems: cache.reviewItems,
    projects: cache.projects,
    tasks: cache.tasks,
    pages: cache.pages,
    chats: cache.chats,
    days: cache.days,
    dayEntries: cache.dayEntries,
    workIntervals: cache.workIntervals,
    stackTemplates: cache.stackTemplates,
    stackPreferences: cache.stackPreferences,
    events: dedupeAndSortEvents(events),
    skippedLines: 0,
  };
}

/** Snapshot rows to write for a full folded state. */
export function entityRowsFromFolded(folded: FoldedEntities): ReadonlyArray<{
  readonly kind: EntityKind;
  readonly id: string;
  readonly payload: string;
  readonly updatedAt: string;
}> {
  const rows: Array<{
    kind: EntityKind;
    id: string;
    payload: string;
    updatedAt: string;
  }> = [];

  for (const project of folded.projects.values()) {
    rows.push({
      kind: "project",
      id: project.id,
      payload: JSON.stringify(project),
      updatedAt: project.updatedAt,
    });
  }
  for (const task of folded.tasks.values()) {
    rows.push({
      kind: "task",
      id: task.id,
      payload: JSON.stringify(task),
      updatedAt: task.updatedAt,
    });
  }
  for (const page of folded.pages.values()) {
    rows.push({
      kind: "page",
      id: page.id,
      payload: JSON.stringify(page),
      updatedAt: page.updatedAt,
    });
  }
  for (const chat of folded.chats.values()) {
    rows.push({
      kind: "chat",
      id: chat.id,
      payload: JSON.stringify(chat),
      updatedAt: chat.updatedAt,
    });
  }
  const dailyMaps = [
    ["review", folded.reviewItems],
    ["day", folded.days],
    ["dayEntry", folded.dayEntries],
    ["workInterval", folded.workIntervals],
    ["stackTemplate", folded.stackTemplates],
    ["stackPreferences", folded.stackPreferences],
  ] as const;
  for (const [kind, entries] of dailyMaps) {
    for (const [id, entity] of entries) {
      rows.push({ kind, id, payload: JSON.stringify(entity), updatedAt: entity.updatedAt });
    }
  }
  return rows;
}

/** Max event `at` for the local clock. */
export function lastSeenAtFromEvents(events: readonly Event[]): string | null {
  let max: string | null = null;
  for (const event of events) {
    if (max === null || event.at > max) max = event.at;
  }
  return max;
}
