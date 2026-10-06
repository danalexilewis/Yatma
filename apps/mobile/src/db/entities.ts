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
} from "@yatma/core";
import { dedupeAndSortEvents } from "@yatma/core";

export type EntityKind = "project" | "task" | "page" | "chat";

export type CachedEntityMaps = {
  readonly projects: Map<ProjectId, Project>;
  readonly tasks: Map<TaskId, Task>;
  readonly pages: Map<PageId, Page>;
  readonly chats: Map<ChatId, Chat>;
};

/** Kind of the entity an event mutates. */
export function entityKindOf(event: Event): EntityKind {
  const kind = event.type.split(".")[0];
  if (kind === "project" || kind === "task" || kind === "page" || kind === "chat") {
    return kind;
  }
  return "task";
}

/** Entity id an event mutates. */
export function entityIdOf(event: Event): string {
  switch (event.type) {
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
  }
}

/** Build FoldedEntities from a cache hit, attaching the event log for history. */
export function foldedFromCache(
  cache: CachedEntityMaps,
  events: readonly Event[],
): FoldedEntities {
  return {
    projects: cache.projects,
    tasks: cache.tasks,
    pages: cache.pages,
    chats: cache.chats,
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
