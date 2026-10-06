// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type {
  ChatCreatedEvent,
  ChatMessageEvent,
  ChatUpdatedEvent,
  Event,
  PageCreatedEvent,
  PageUpdatedEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from "./events.ts";
import { Event as EventSchema } from "./events.ts";
import type { ChatId, PageId, ProjectId, TaskId } from "./ids.ts";
import type { Chat, Page, Project, Task } from "./schemas.ts";

const decodeEvent = Schema.decodeUnknownOption(EventSchema);

export type ParsedEventLine =
  | { readonly ok: true; readonly event: Event }
  | { readonly ok: false; readonly reason: "empty" | "invalid" };

export function parseEventLine(line: string): ParsedEventLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const decoded = decodeEvent(raw);
  if (Option.isNone(decoded)) return { ok: false, reason: "invalid" };
  return { ok: true, event: decoded.value };
}

export function compareEvents(a: Event, b: Event): number {
  if (a.at < b.at) return -1;
  if (a.at > b.at) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Sort by (at, id) and drop duplicate ids (last occurrence wins before sort). */
export function dedupeAndSortEvents(events: readonly Event[]): Event[] {
  const byId = new Map<string, Event>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  return [...byId.values()].toSorted(compareEvents);
}

function applyTaskCreated(tasks: Map<TaskId, Task>, event: TaskCreatedEvent): void {
  tasks.set(event.taskId, {
    id: event.taskId,
    projectId: event.projectId,
    title: event.title,
    notes: event.notes ?? "",
    dueDate: event.dueDate ?? null,
    status: event.status,
    quadrant: event.quadrant,
    position: event.position,
    createdAt: event.at,
    createdBy: event.by,
    updatedAt: event.at,
    completedAt: event.status === "done" ? event.at : null,
    deletedAt: null,
    lastReason: event.reason ?? null,
  });
}

function applyTaskUpdated(tasks: Map<TaskId, Task>, event: TaskUpdatedEvent): void {
  const existing = tasks.get(event.taskId);
  if (!existing) return;
  const set = event.set;
  const nextStatus = set.status ?? existing.status;
  const deleted = set.deleted;
  tasks.set(event.taskId, {
    ...existing,
    projectId: set.projectId !== undefined ? set.projectId : existing.projectId,
    title: set.title ?? existing.title,
    notes: set.notes ?? existing.notes,
    dueDate: set.dueDate !== undefined ? set.dueDate : existing.dueDate,
    status: nextStatus,
    quadrant: set.quadrant !== undefined ? set.quadrant : existing.quadrant,
    position: set.position ?? existing.position,
    updatedAt: event.at,
    completedAt:
      nextStatus === "done"
        ? (existing.completedAt ?? event.at)
        : nextStatus !== existing.status
          ? null
          : existing.completedAt,
    deletedAt:
      deleted === true
        ? (existing.deletedAt ?? event.at)
        : deleted === false
          ? null
          : existing.deletedAt,
    lastReason: event.reason ?? existing.lastReason,
  });
}

function applyProjectCreated(projects: Map<ProjectId, Project>, event: ProjectCreatedEvent): void {
  projects.set(event.projectId, {
    id: event.projectId,
    title: event.title,
    color: event.color ?? null,
    archivedAt: null,
    createdAt: event.at,
    updatedAt: event.at,
  });
}

function applyProjectUpdated(projects: Map<ProjectId, Project>, event: ProjectUpdatedEvent): void {
  const existing = projects.get(event.projectId);
  if (!existing) return;
  const set = event.set;
  projects.set(event.projectId, {
    ...existing,
    title: set.title ?? existing.title,
    color: set.color !== undefined ? set.color : existing.color,
    archivedAt:
      set.archived === true
        ? (existing.archivedAt ?? event.at)
        : set.archived === false
          ? null
          : existing.archivedAt,
    updatedAt: event.at,
  });
}

function applyPageCreated(pages: Map<PageId, Page>, event: PageCreatedEvent): void {
  pages.set(event.pageId, {
    id: event.pageId,
    projectId: event.projectId,
    kind: event.kind,
    title: event.title,
    body: event.body,
    pinned: event.pinned ?? false,
    createdAt: event.at,
    updatedAt: event.at,
    deletedAt: null,
    lastReason: event.reason ?? null,
  });
}

function applyPageUpdated(pages: Map<PageId, Page>, event: PageUpdatedEvent): void {
  const existing = pages.get(event.pageId);
  if (!existing) return;
  const set = event.set;
  pages.set(event.pageId, {
    ...existing,
    title: set.title ?? existing.title,
    body: set.body ?? existing.body,
    pinned: set.pinned ?? existing.pinned,
    updatedAt: event.at,
    deletedAt:
      set.deleted === true
        ? (existing.deletedAt ?? event.at)
        : set.deleted === false
          ? null
          : existing.deletedAt,
    lastReason: event.reason ?? existing.lastReason,
  });
}

function applyChatCreated(chats: Map<ChatId, Chat>, event: ChatCreatedEvent): void {
  chats.set(event.chatId, {
    id: event.chatId,
    projectId: event.projectId,
    title: event.title ?? null,
    summary: null,
    messages: [],
    createdAt: event.at,
    updatedAt: event.at,
  });
}

function applyChatMessage(chats: Map<ChatId, Chat>, event: ChatMessageEvent): void {
  const existing = chats.get(event.chatId);
  if (!existing) return;
  const without = existing.messages.filter((message) => message.id !== event.messageId);
  chats.set(event.chatId, {
    ...existing,
    messages: [
      ...without,
      {
        id: event.messageId,
        role: event.role,
        text: event.text,
        at: event.at,
      },
    ].toSorted((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    }),
    updatedAt: event.at,
  });
}

function applyChatUpdated(chats: Map<ChatId, Chat>, event: ChatUpdatedEvent): void {
  const existing = chats.get(event.chatId);
  if (!existing) return;
  const set = event.set;
  chats.set(event.chatId, {
    ...existing,
    title: set.title !== undefined ? set.title : existing.title,
    summary: set.summary !== undefined ? set.summary : existing.summary,
    updatedAt: event.at,
  });
}

export type FoldedEntities = {
  readonly projects: ReadonlyMap<ProjectId, Project>;
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly pages: ReadonlyMap<PageId, Page>;
  readonly chats: ReadonlyMap<ChatId, Chat>;
  readonly events: readonly Event[];
  readonly skippedLines: number;
};

function emptyFolded(skippedLines = 0): FoldedEntities {
  return {
    projects: new Map(),
    tasks: new Map(),
    pages: new Map(),
    chats: new Map(),
    events: [],
    skippedLines,
  };
}

/** Apply a sorted, deduped event stream onto entity maps (last write wins per field). */
export function foldEvents(events: readonly Event[]): FoldedEntities {
  const ordered = dedupeAndSortEvents(events);
  const projects = new Map<ProjectId, Project>();
  const tasks = new Map<TaskId, Task>();
  const pages = new Map<PageId, Page>();
  const chats = new Map<ChatId, Chat>();

  for (const event of ordered) {
    switch (event.type) {
      case "project.created":
        applyProjectCreated(projects, event);
        break;
      case "project.updated":
        applyProjectUpdated(projects, event);
        break;
      case "task.created":
        applyTaskCreated(tasks, event);
        break;
      case "task.updated":
        applyTaskUpdated(tasks, event);
        break;
      case "page.created":
        applyPageCreated(pages, event);
        break;
      case "page.updated":
        applyPageUpdated(pages, event);
        break;
      case "chat.created":
        applyChatCreated(chats, event);
        break;
      case "chat.message":
        applyChatMessage(chats, event);
        break;
      case "chat.updated":
        applyChatUpdated(chats, event);
        break;
    }
  }

  return { projects, tasks, pages, chats, events: ordered, skippedLines: 0 };
}

/** Fold JSONL lines into entity state. Unknown/invalid lines are skipped. */
export function foldEventLines(lines: readonly string[]): FoldedEntities {
  const parsed: Event[] = [];
  let skippedLines = 0;
  for (const line of lines) {
    const result = parseEventLine(line);
    if (!result.ok) {
      if (result.reason === "invalid") skippedLines += 1;
      continue;
    }
    parsed.push(result.event);
  }
  const folded = foldEvents(parsed);
  return { ...folded, skippedLines };
}

export function foldTaskEvents(events: readonly Event[]): ReadonlyMap<TaskId, Task> {
  return foldEvents(events.filter((event) => event.type.startsWith("task."))).tasks;
}

export function foldProjectEvents(events: readonly Event[]): ReadonlyMap<ProjectId, Project> {
  return foldEvents(events.filter((event) => event.type.startsWith("project."))).projects;
}

export function foldPageEvents(events: readonly Event[]): ReadonlyMap<PageId, Page> {
  return foldEvents(events.filter((event) => event.type.startsWith("page."))).pages;
}

export function foldChatEvents(events: readonly Event[]): ReadonlyMap<ChatId, Chat> {
  return foldEvents(events.filter((event) => event.type.startsWith("chat."))).chats;
}

export function encodeEvent(event: Event): string {
  return `${JSON.stringify(event)}\n`;
}

export { emptyFolded };
