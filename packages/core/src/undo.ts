// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { Event, PageUpdatedEvent, ProjectUpdatedEvent, TaskUpdatedEvent } from "./events.ts";
import type { ChatId, PageId, ProjectId, TaskId } from "./ids.ts";
import type { EventId } from "./ids.ts";
import type {
  Chat,
  ChatUpdatedFields,
  Page,
  PageUpdatedFields,
  Project,
  ProjectUpdatedFields,
  Task,
  TaskUpdatedFields,
} from "./schemas.ts";

export type Entities = {
  readonly projects: ReadonlyMap<ProjectId, Project>;
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly pages: ReadonlyMap<PageId, Page>;
  readonly chats: ReadonlyMap<ChatId, Chat>;
};

export type UndoSkip = {
  readonly entityId: string;
  readonly field: string;
  readonly reason: "changed_since" | "missing_entity" | "missing_preimage";
};

export type UndoRevert =
  | {
      readonly type: "task.updated";
      readonly taskId: TaskId;
      readonly set: TaskUpdatedFields;
    }
  | {
      readonly type: "project.updated";
      readonly projectId: ProjectId;
      readonly set: ProjectUpdatedFields;
    }
  | {
      readonly type: "page.updated";
      readonly pageId: PageId;
      readonly set: PageUpdatedFields;
    }
  | {
      readonly type: "chat.updated";
      readonly chatId: ChatId;
      readonly set: ChatUpdatedFields;
    }
  | {
      readonly type: "task.updated";
      readonly taskId: TaskId;
      readonly set: { readonly deleted: true };
      readonly fromCreate: true;
    }
  | {
      readonly type: "project.updated";
      readonly projectId: ProjectId;
      readonly set: { readonly archived: true };
      readonly fromCreate: true;
    }
  | {
      readonly type: "page.updated";
      readonly pageId: PageId;
      readonly set: { readonly deleted: true };
      readonly fromCreate: true;
    };

export type UndoPlan = {
  readonly reverts: readonly UndoRevert[];
  readonly skipped: readonly UndoSkip[];
};

/** Latest event that wrote each entity field, keyed by `kind:id`. */
export type LatestWrites = ReadonlyMap<string, ReadonlyMap<string, EventId>>;

/** Build per-field latest-write provenance from the complete ordered event history. */
export function latestWritesFromEvents(events: readonly Event[]): LatestWrites {
  const latest = new Map<string, Map<string, EventId>>();
  const createdProjects = new Set<ProjectId>();
  function write(kind: string, id: string, fields: readonly string[], eventId: EventId): void {
    const key = `${kind}:${id}`;
    const fieldsByEntity = latest.get(key) ?? new Map<string, EventId>();
    for (const field of fields) fieldsByEntity.set(field, eventId);
    latest.set(key, fieldsByEntity);
  }
  const ordered = [...events].toSorted(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
  for (const event of ordered) {
    switch (event.type) {
      case "task.created":
        write(
          "task",
          event.taskId,
          [
            "projectId",
            "title",
            "tags",
            "notes",
            "dueDate",
            "status",
            "quadrant",
            "position",
            "deleted",
          ],
          event.id,
        );
        break;
      case "task.updated":
        write("task", event.taskId, Object.keys(event.set), event.id);
        break;
      case "project.created":
        if (createdProjects.has(event.projectId)) break;
        createdProjects.add(event.projectId);
        write(
          "project",
          event.projectId,
          ["title", "color", "description", "targetDate", "bookmarks", "archived"],
          event.id,
        );
        break;
      case "project.updated":
        write("project", event.projectId, Object.keys(event.set), event.id);
        break;
      case "page.created":
        write(
          "page",
          event.pageId,
          ["projectId", "kind", "title", "body", "pinned", "deleted"],
          event.id,
        );
        break;
      case "page.updated":
        write("page", event.pageId, Object.keys(event.set), event.id);
        break;
      case "chat.created":
        write("chat", event.chatId, ["projectId", "title", "summary", "headings"], event.id);
        break;
      case "chat.updated":
        write("chat", event.chatId, Object.keys(event.set), event.id);
        break;
    }
  }
  return latest;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => valuesEqual(value, b[index]));
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const left = Object.entries(a);
    return (
      left.length === Object.keys(b).length &&
      left.every(
        ([key, value]) =>
          Object.hasOwn(b, key) && valuesEqual(value, (b as Record<string, unknown>)[key]),
      )
    );
  }
  if (a == null || b == null) return a === b;
  return false;
}

function readTaskField(task: Task, field: keyof TaskUpdatedFields): unknown {
  if (field === "deleted") return task.deletedAt !== null;
  if (field === "tags") return task.tags ?? [];
  return task[field as keyof Task];
}

function readProjectField(project: Project, field: keyof ProjectUpdatedFields): unknown {
  if (field === "archived") return project.archivedAt !== null;
  if (field === "description") return project.description ?? "";
  if (field === "targetDate") return project.targetDate ?? null;
  if (field === "bookmarks") return project.bookmarks ?? [];
  return project[field as keyof Project];
}

function readPageField(page: Page, field: keyof PageUpdatedFields): unknown {
  if (field === "deleted") return page.deletedAt !== null;
  return page[field as keyof Page];
}

function readChatField(chat: Chat, field: keyof ChatUpdatedFields): unknown {
  if (field === "headings") return chat.headings ?? [];
  return chat[field as keyof Chat];
}

function planTaskUpdateUndo(
  event: TaskUpdatedEvent,
  current: Entities,
  skipped: UndoSkip[],
  latestWrites?: LatestWrites,
): UndoRevert | null {
  const task = current.tasks.get(event.taskId);
  if (!task) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.taskId, field, reason: "missing_entity" });
    }
    return null;
  }
  if (event.prev === undefined) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.taskId, field, reason: "missing_preimage" });
    }
    return null;
  }

  const set: Record<string, unknown> = {};
  for (const key of Object.keys(event.set) as Array<keyof TaskUpdatedFields>) {
    const latest = latestWrites?.get(`task:${event.taskId}`)?.get(key);
    if (latestWrites && latest !== event.id) {
      skipped.push({ entityId: event.taskId, field: key, reason: "changed_since" });
      continue;
    }
    const batchValue = event.set[key];
    if (batchValue === undefined) continue;
    const currentValue = readTaskField(task, key);
    if (!valuesEqual(currentValue, batchValue)) {
      skipped.push({ entityId: event.taskId, field: key, reason: "changed_since" });
      continue;
    }
    const prevValue = event.prev[key];
    if (prevValue === undefined) {
      skipped.push({ entityId: event.taskId, field: key, reason: "missing_preimage" });
      continue;
    }
    set[key] = prevValue;
  }
  if (Object.keys(set).length === 0) return null;
  return { type: "task.updated", taskId: event.taskId, set: set as TaskUpdatedFields };
}

function planProjectUpdateUndo(
  event: ProjectUpdatedEvent,
  current: Entities,
  skipped: UndoSkip[],
  latestWrites?: LatestWrites,
): UndoRevert | null {
  const project = current.projects.get(event.projectId);
  if (!project) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.projectId, field, reason: "missing_entity" });
    }
    return null;
  }
  if (event.prev === undefined) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.projectId, field, reason: "missing_preimage" });
    }
    return null;
  }

  const set: Record<string, unknown> = {};
  for (const key of Object.keys(event.set) as Array<keyof ProjectUpdatedFields>) {
    const latest = latestWrites?.get(`project:${event.projectId}`)?.get(key);
    if (latestWrites && latest !== event.id) {
      skipped.push({ entityId: event.projectId, field: key, reason: "changed_since" });
      continue;
    }
    const batchValue = event.set[key];
    if (batchValue === undefined) continue;
    const currentValue = readProjectField(project, key);
    if (!valuesEqual(currentValue, batchValue)) {
      skipped.push({ entityId: event.projectId, field: key, reason: "changed_since" });
      continue;
    }
    const prevValue = event.prev[key];
    if (prevValue === undefined) {
      skipped.push({ entityId: event.projectId, field: key, reason: "missing_preimage" });
      continue;
    }
    set[key] = prevValue;
  }
  if (Object.keys(set).length === 0) return null;
  return { type: "project.updated", projectId: event.projectId, set: set as ProjectUpdatedFields };
}

function planPageUpdateUndo(
  event: PageUpdatedEvent,
  current: Entities,
  skipped: UndoSkip[],
  latestWrites?: LatestWrites,
): UndoRevert | null {
  const page = current.pages.get(event.pageId);
  if (!page) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.pageId, field, reason: "missing_entity" });
    }
    return null;
  }
  if (event.prev === undefined) {
    for (const field of Object.keys(event.set)) {
      skipped.push({ entityId: event.pageId, field, reason: "missing_preimage" });
    }
    return null;
  }

  const set: Record<string, unknown> = {};
  for (const key of Object.keys(event.set) as Array<keyof PageUpdatedFields>) {
    const latest = latestWrites?.get(`page:${event.pageId}`)?.get(key);
    if (latestWrites && latest !== event.id) {
      skipped.push({ entityId: event.pageId, field: key, reason: "changed_since" });
      continue;
    }
    const batchValue = event.set[key];
    if (batchValue === undefined) continue;
    const currentValue = readPageField(page, key);
    if (!valuesEqual(currentValue, batchValue)) {
      skipped.push({ entityId: event.pageId, field: key, reason: "changed_since" });
      continue;
    }
    const prevValue = event.prev[key];
    if (prevValue === undefined) {
      skipped.push({ entityId: event.pageId, field: key, reason: "missing_preimage" });
      continue;
    }
    set[key] = prevValue;
  }
  if (Object.keys(set).length === 0) return null;
  return { type: "page.updated", pageId: event.pageId, set: set as PageUpdatedFields };
}

/**
 * Revert a batch: only fields that still hold the batch's written values are
 * restored (using each update event's `prev`). Creates become soft-deletes
 * when the entity is still present.
 */
export function planUndo(
  batchEvents: readonly Event[],
  currentEntities: Entities,
  latestWrites?: LatestWrites,
): UndoPlan {
  const reverts: UndoRevert[] = [];
  const skipped: UndoSkip[] = [];

  // Latest write per entity field wins; process in forward order and keep last revert.
  const taskReverts = new Map<TaskId, UndoRevert>();
  const projectReverts = new Map<ProjectId, UndoRevert>();
  const pageReverts = new Map<PageId, UndoRevert>();
  const chatReverts = new Map<ChatId, UndoRevert>();
  const createdTasks = new Set<TaskId>();
  const createdProjects = new Set<ProjectId>();
  const createdPages = new Set<PageId>();

  const earliestPrev = new Map<string, Record<string, unknown>>();
  const finalSets = new Map<string, Record<string, unknown>>();
  const finalEvents = new Map<string, Event>();
  const finalFieldIds = new Map<string, Map<string, EventId>>();
  for (const event of batchEvents) {
    if (
      event.type !== "task.updated" &&
      event.type !== "project.updated" &&
      event.type !== "page.updated" &&
      event.type !== "chat.updated"
    )
      continue;
    const kind = event.type.split(".")[0]!;
    const id =
      event.type === "task.updated"
        ? event.taskId
        : event.type === "project.updated"
          ? event.projectId
          : event.type === "page.updated"
            ? event.pageId
            : event.chatId;
    const key = `${kind}:${id}`;
    const prev = earliestPrev.get(key) ?? {};
    const set = finalSets.get(key) ?? {};
    const fieldIds = finalFieldIds.get(key) ?? new Map<string, EventId>();
    for (const field of Object.keys(event.set)) {
      if (!(field in prev) && event.prev && field in event.prev)
        prev[field] = event.prev[field as keyof typeof event.prev];
      set[field] = event.set[field as keyof typeof event.set];
      fieldIds.set(field, event.id);
    }
    earliestPrev.set(key, prev);
    finalSets.set(key, set);
    finalEvents.set(key, event);
    finalFieldIds.set(key, fieldIds);
  }
  const aggregated = new Map<string, Event>();
  for (const [key, event] of finalEvents) {
    const set = finalSets.get(key)!;
    const prev = earliestPrev.get(key)!;
    const [kind, id] = key.split(":", 2);
    const latestForEntity = latestWrites?.get(`${kind}:${id}`);
    if (latestWrites) {
      for (const field of Object.keys(set)) {
        const finalId = finalFieldIds.get(key)?.get(field);
        if (latestForEntity?.get(field) !== finalId) {
          skipped.push({ entityId: id!, field, reason: "changed_since" });
          delete set[field];
          delete prev[field];
        }
      }
    }
    if (event.type === "task.updated")
      aggregated.set(key, { ...event, set, prev } as TaskUpdatedEvent);
    else if (event.type === "project.updated")
      aggregated.set(key, { ...event, set, prev } as ProjectUpdatedEvent);
    else if (event.type === "page.updated")
      aggregated.set(key, { ...event, set, prev } as PageUpdatedEvent);
    else aggregated.set(key, { ...event, set, prev } as Event);
  }
  const batchEventIds = new Set(batchEvents.map((event) => event.id));
  function skipCreatedUndoIfChanged(kind: string, entityId: string): boolean {
    const latest = latestWrites?.get(`${kind}:${entityId}`);
    if (!latestWrites || !latest) return false;
    let changed = false;
    for (const [field, eventId] of latest) {
      if (!batchEventIds.has(eventId)) {
        skipped.push({ entityId, field, reason: "changed_since" });
        changed = true;
      }
    }
    return changed;
  }

  for (const event of batchEvents) {
    switch (event.type) {
      case "task.created": {
        createdTasks.add(event.taskId);
        if (skipCreatedUndoIfChanged("task", event.taskId)) break;
        const task = currentEntities.tasks.get(event.taskId);
        if (!task || task.deletedAt !== null) {
          skipped.push({
            entityId: event.taskId,
            field: "deleted",
            reason: task ? "changed_since" : "missing_entity",
          });
          break;
        }
        taskReverts.set(event.taskId, {
          type: "task.updated",
          taskId: event.taskId,
          set: { deleted: true },
          fromCreate: true,
        });
        break;
      }
      case "task.updated": {
        const aggregatedTask = aggregated.get(`task:${event.taskId}`) as TaskUpdatedEvent;
        if (!createdTasks.has(event.taskId) && aggregatedTask.id === event.id) {
          const revert = planTaskUpdateUndo(aggregatedTask, currentEntities, skipped);
          if (revert) taskReverts.set(event.taskId, revert);
        }
        break;
      }
      case "project.created": {
        createdProjects.add(event.projectId);
        if (skipCreatedUndoIfChanged("project", event.projectId)) break;
        const project = currentEntities.projects.get(event.projectId);
        if (!project) {
          skipped.push({
            entityId: event.projectId,
            field: "archived",
            reason: "missing_entity",
          });
          break;
        }
        projectReverts.set(event.projectId, {
          type: "project.updated",
          projectId: event.projectId,
          set: { archived: true },
          fromCreate: true,
        });
        break;
      }
      case "project.updated": {
        const aggregatedProject = aggregated.get(
          `project:${event.projectId}`,
        ) as ProjectUpdatedEvent;
        if (!createdProjects.has(event.projectId) && aggregatedProject.id === event.id) {
          const revert = planProjectUpdateUndo(aggregatedProject, currentEntities, skipped);
          if (revert) projectReverts.set(event.projectId, revert);
        }
        break;
      }
      case "page.created": {
        createdPages.add(event.pageId);
        if (skipCreatedUndoIfChanged("page", event.pageId)) break;
        const page = currentEntities.pages.get(event.pageId);
        if (!page || page.deletedAt !== null) {
          skipped.push({
            entityId: event.pageId,
            field: "deleted",
            reason: page ? "changed_since" : "missing_entity",
          });
          break;
        }
        pageReverts.set(event.pageId, {
          type: "page.updated",
          pageId: event.pageId,
          set: { deleted: true },
          fromCreate: true,
        });
        break;
      }
      case "page.updated": {
        const aggregatedPage = aggregated.get(`page:${event.pageId}`) as PageUpdatedEvent;
        if (!createdPages.has(event.pageId) && aggregatedPage.id === event.id) {
          const revert = planPageUpdateUndo(aggregatedPage, currentEntities, skipped);
          if (revert) pageReverts.set(event.pageId, revert);
        }
        break;
      }
      case "chat.updated": {
        const aggregatedChat = aggregated.get(`chat:${event.chatId}`) as Event;
        if (event.id !== aggregatedChat.id) break;
        const mergedEvent = aggregatedChat as typeof event;
        const chat = currentEntities.chats.get(mergedEvent.chatId);
        if (!chat) {
          for (const field of Object.keys(mergedEvent.set)) {
            skipped.push({ entityId: mergedEvent.chatId, field, reason: "missing_entity" });
          }
          break;
        }
        if (mergedEvent.prev === undefined) {
          for (const field of Object.keys(mergedEvent.set)) {
            skipped.push({ entityId: mergedEvent.chatId, field, reason: "missing_preimage" });
          }
          break;
        }
        const set: Record<string, unknown> = {};
        for (const key of Object.keys(mergedEvent.set) as Array<keyof ChatUpdatedFields>) {
          const latest = latestWrites?.get(`chat:${mergedEvent.chatId}`)?.get(key);
          if (latestWrites && latest !== mergedEvent.id) {
            skipped.push({ entityId: mergedEvent.chatId, field: key, reason: "changed_since" });
            continue;
          }
          const batchValue = mergedEvent.set[key];
          if (batchValue === undefined) continue;
          const currentValue = readChatField(chat, key);
          if (!valuesEqual(currentValue, batchValue)) {
            skipped.push({ entityId: event.chatId, field: key, reason: "changed_since" });
            continue;
          }
          const prevValue = mergedEvent.prev[key];
          if (prevValue === undefined) {
            skipped.push({ entityId: event.chatId, field: key, reason: "missing_preimage" });
            continue;
          }
          set[key] = prevValue;
        }
        if (Object.keys(set).length > 0) {
          chatReverts.set(mergedEvent.chatId, {
            type: "chat.updated",
            chatId: mergedEvent.chatId,
            set: set as ChatUpdatedFields,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  reverts.push(
    ...taskReverts.values(),
    ...projectReverts.values(),
    ...pageReverts.values(),
    ...chatReverts.values(),
  );
  return { reverts, skipped };
}
