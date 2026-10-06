// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { Event, PageUpdatedEvent, ProjectUpdatedEvent, TaskUpdatedEvent } from "./events.ts";
import type { ChatId, PageId, ProjectId, TaskId } from "./ids.ts";
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

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return false;
}

function readTaskField(task: Task, field: keyof TaskUpdatedFields): unknown {
  if (field === "deleted") return task.deletedAt !== null;
  return task[field as keyof Task];
}

function readProjectField(project: Project, field: keyof ProjectUpdatedFields): unknown {
  if (field === "archived") return project.archivedAt !== null;
  return project[field as keyof Project];
}

function readPageField(page: Page, field: keyof PageUpdatedFields): unknown {
  if (field === "deleted") return page.deletedAt !== null;
  return page[field as keyof Page];
}

function readChatField(chat: Chat, field: keyof ChatUpdatedFields): unknown {
  return chat[field as keyof Chat];
}

function planTaskUpdateUndo(
  event: TaskUpdatedEvent,
  current: Entities,
  skipped: UndoSkip[],
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
export function planUndo(batchEvents: readonly Event[], currentEntities: Entities): UndoPlan {
  const reverts: UndoRevert[] = [];
  const skipped: UndoSkip[] = [];

  // Latest write per entity field wins; process in forward order and keep last revert.
  const taskReverts = new Map<TaskId, UndoRevert>();
  const projectReverts = new Map<ProjectId, UndoRevert>();
  const pageReverts = new Map<PageId, UndoRevert>();
  const chatReverts = new Map<ChatId, UndoRevert>();

  for (const event of batchEvents) {
    switch (event.type) {
      case "task.created": {
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
        const revert = planTaskUpdateUndo(event, currentEntities, skipped);
        if (revert) taskReverts.set(event.taskId, revert);
        break;
      }
      case "project.created": {
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
        const revert = planProjectUpdateUndo(event, currentEntities, skipped);
        if (revert) projectReverts.set(event.projectId, revert);
        break;
      }
      case "page.created": {
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
        const revert = planPageUpdateUndo(event, currentEntities, skipped);
        if (revert) pageReverts.set(event.pageId, revert);
        break;
      }
      case "chat.updated": {
        const chat = currentEntities.chats.get(event.chatId);
        if (!chat) {
          for (const field of Object.keys(event.set)) {
            skipped.push({ entityId: event.chatId, field, reason: "missing_entity" });
          }
          break;
        }
        if (event.prev === undefined) {
          for (const field of Object.keys(event.set)) {
            skipped.push({ entityId: event.chatId, field, reason: "missing_preimage" });
          }
          break;
        }
        const set: Record<string, unknown> = {};
        for (const key of Object.keys(event.set) as Array<keyof ChatUpdatedFields>) {
          const batchValue = event.set[key];
          if (batchValue === undefined) continue;
          const currentValue = readChatField(chat, key);
          if (!valuesEqual(currentValue, batchValue)) {
            skipped.push({ entityId: event.chatId, field: key, reason: "changed_since" });
            continue;
          }
          const prevValue = event.prev[key];
          if (prevValue === undefined) {
            skipped.push({ entityId: event.chatId, field: key, reason: "missing_preimage" });
            continue;
          }
          set[key] = prevValue;
        }
        if (Object.keys(set).length > 0) {
          chatReverts.set(event.chatId, {
            type: "chat.updated",
            chatId: event.chatId,
            set: set as ChatUpdatedFields,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  reverts.push(...taskReverts.values(), ...projectReverts.values(), ...pageReverts.values(), ...chatReverts.values());
  return { reverts, skipped };
}
