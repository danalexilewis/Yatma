// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { Event } from "./events.ts";
import { Event as EventSchema } from "./events.ts";
import type { BatchId, ChatId, EventId, PageId, ProjectId, TaskId } from "./ids.ts";
import {
  ChatId as ChatIdSchema,
  PageId as PageIdSchema,
  ProjectId as ProjectIdSchema,
  TaskId as TaskIdSchema,
} from "./ids.ts";
import { nextAt } from "./clock.ts";
import type { Entities } from "./undo.ts";
import { planCreate, planProjectCreate, planProjectUpdate, planUpdate } from "./rules.ts";
import type { Actor, Chat, Page, Project, Task } from "./schemas.ts";
import {
  ChatMessageRole,
  PageBody,
  PageKind,
  Reason,
  ProjectCreateInput,
  ProjectUpdateInput,
  TaskCreateInput,
  TaskUpdateInput,
  TaskTags,
  Title,
} from "./schemas.ts";

const PageCreateInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectIdSchema)),
  kind: PageKind,
  title: Title,
  body: PageBody,
  pinned: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Reason),
});
const PageUpdateInput = Schema.Struct({
  pageId: PageIdSchema,
  title: Schema.optional(Title),
  body: Schema.optional(PageBody),
  pinned: Schema.optional(Schema.Boolean),
  deleted: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Reason),
});
const ChatCreateInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectIdSchema),
  title: Schema.optional(Schema.NullOr(Title)),
});
const ChatUpdateInput = Schema.Struct({
  chatId: ChatIdSchema,
  title: Schema.optional(Schema.NullOr(Title)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  headings: Schema.optional(TaskTags),
});
const BatchCommandSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("task.create"),
    taskId: TaskIdSchema,
    input: TaskCreateInput,
  }),
  Schema.Struct({ type: Schema.Literal("task.update"), input: TaskUpdateInput }),
  Schema.Struct({
    type: Schema.Literal("project.create"),
    projectId: ProjectIdSchema,
    input: ProjectCreateInput,
  }),
  Schema.Struct({ type: Schema.Literal("project.update"), input: ProjectUpdateInput }),
  Schema.Struct({
    type: Schema.Literal("page.create"),
    pageId: PageIdSchema,
    input: PageCreateInput,
  }),
  Schema.Struct({ type: Schema.Literal("page.update"), input: PageUpdateInput }),
  Schema.Struct({
    type: Schema.Literal("chat.create"),
    chatId: ChatIdSchema,
    input: ChatCreateInput,
  }),
  Schema.Struct({ type: Schema.Literal("chat.update"), input: ChatUpdateInput }),
  Schema.Struct({
    type: Schema.Literal("chat.message"),
    chatId: ChatIdSchema,
    messageId: Schema.String.check(Schema.isNonEmpty()),
    role: ChatMessageRole,
    text: Schema.String,
  }),
]);

/** One atomic user or agent command, with IDs allocated by its caller. */
export type BatchCommand =
  | {
      readonly type: "task.create";
      readonly taskId: TaskId;
      readonly input: typeof TaskCreateInput.Type;
    }
  | { readonly type: "task.update"; readonly input: typeof TaskUpdateInput.Type }
  | {
      readonly type: "project.create";
      readonly projectId: ProjectId;
      readonly input: {
        readonly title: string;
        readonly color?: string | null;
        readonly reason?: string;
      };
    }
  | { readonly type: "project.update"; readonly input: typeof ProjectUpdateInput.Type }
  | {
      readonly type: "page.create";
      readonly pageId: PageId;
      readonly input: typeof PageCreateInput.Type;
    }
  | { readonly type: "page.update"; readonly input: typeof PageUpdateInput.Type }
  | {
      readonly type: "chat.create";
      readonly chatId: ChatId;
      readonly input: typeof ChatCreateInput.Type;
    }
  | { readonly type: "chat.update"; readonly input: typeof ChatUpdateInput.Type }
  | {
      readonly type: "chat.message";
      readonly chatId: ChatId;
      readonly messageId: string;
      readonly role: "user" | "assistant" | "system";
      readonly text: string;
    };

export type EventDraft = Event extends infer E
  ? E extends Event
    ? Omit<E, "id" | "at" | "seq">
    : never
  : never;
export type BatchSnapshot = Entities;
export type PlanFailure = {
  readonly code: "invalid_command" | "missing_reference" | "reason_required" | "entity_conflict";
  readonly commandIndex: number;
  readonly path?: string;
  readonly entityId?: string;
  readonly message: string;
};
export type PlanBatchDraft = {
  readonly drafts: readonly EventDraft[];
  readonly noops: readonly { readonly commandIndex: number; readonly reason: "unchanged" }[];
  readonly finalSnapshot: BatchSnapshot;
};
export type PlanBatchContext = {
  readonly actor: Actor;
  readonly batchId?: BatchId;
  readonly undoes?: BatchId;
};
export type StampFailure = {
  readonly code: "invalid_clock" | "id_count_mismatch" | "invalid_event";
  readonly eventIndex?: number;
  readonly message: string;
};

const INVALID_AT = "1970-01-01T00:00:00.000Z";
const ZERO_ID = "00000000000000000000000000" as EventId;

function eventFromDraft(draft: EventDraft, index: number): Event {
  return {
    ...draft,
    id: (index === 0 ? ZERO_ID : `${index}`.padStart(26, "0")) as EventId,
    at: INVALID_AT,
  } as Event;
}

function failure(
  code: PlanFailure["code"],
  commandIndex: number,
  message: string,
  path?: string,
  entityId?: string,
): PlanFailure {
  return {
    code,
    commandIndex,
    message,
    ...(path ? { path } : {}),
    ...(entityId ? { entityId } : {}),
  };
}

function eventDraft(event: Event, context: PlanBatchContext): EventDraft {
  const { id: _id, at: _at, seq: _seq, ...payload } = event;
  return {
    ...payload,
    ...(context.batchId ? { batch: context.batchId } : {}),
    ...(context.undoes ? { undoes: context.undoes } : {}),
  } as EventDraft;
}

/** Validate and stage every command before exposing any event drafts. */
export function planBatch(
  snapshot: BatchSnapshot,
  commands: readonly BatchCommand[],
  context: PlanBatchContext,
): Result.Result<PlanBatchDraft, PlanFailure> {
  const projects = new Map(snapshot.projects);
  const tasks = new Map(snapshot.tasks);
  const pages = new Map(snapshot.pages);
  const chats = new Map(snapshot.chats);
  const drafts: EventDraft[] = [];
  const noops: { commandIndex: number; reason: "unchanged" }[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const rawCommand = commands[index]!;
    const parsedCommand = Schema.decodeUnknownOption(BatchCommandSchema)(rawCommand);
    if (Option.isNone(parsedCommand))
      return Result.fail(
        failure("invalid_command", index, "Command failed schema validation", "command"),
      );
    const command = parsedCommand.value as BatchCommand;
    let event: Event | null = null;
    switch (command.type) {
      case "task.create": {
        if (tasks.has(command.taskId))
          return Result.fail(
            failure("entity_conflict", index, "Task ID already exists", "taskId", command.taskId),
          );
        if (command.input.projectId && !projects.has(command.input.projectId))
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Project does not exist",
              "input.projectId",
              command.input.projectId,
            ),
          );
        const planned = planCreate([...tasks.values()], command.input, context.actor);
        if (Result.isFailure(planned))
          return Result.fail(
            failure("reason_required", index, "Agent commands require a reason", "input.reason"),
          );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "task.created",
          taskId: command.taskId,
          projectId: planned.success.projectId,
          title: planned.success.title,
          tags: [...new Set(command.input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [])],
          notes: planned.success.notes,
          dueDate: command.input.dueDate ?? null,
          status: "todo",
          quadrant: null,
          position: planned.success.position,
          ...(planned.success.reason ? { reason: planned.success.reason } : {}),
        };
        break;
      }
      case "task.update": {
        const existing = tasks.get(command.input.taskId);
        if (!existing)
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Task does not exist",
              "input.taskId",
              command.input.taskId,
            ),
          );
        if (command.input.projectId && !projects.has(command.input.projectId))
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Project does not exist",
              "input.projectId",
              command.input.projectId,
            ),
          );
        const planned = planUpdate([...tasks.values()], command.input, context.actor);
        if (Result.isFailure(planned))
          return Result.fail(
            failure(
              planned.failure._tag === "AgentReasonRequired"
                ? "reason_required"
                : "missing_reference",
              index,
              planned.failure._tag,
              "input",
            ),
          );
        if (planned.success.kind === "noop") {
          noops.push({ commandIndex: index, reason: "unchanged" });
          break;
        }
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "task.updated",
          taskId: existing.id,
          set: planned.success.set,
          prev: Object.fromEntries(
            Object.keys(planned.success.set).map((key) => [
              key,
              key === "deleted"
                ? existing.deletedAt !== null
                : key === "tags"
                  ? (existing.tags ?? [])
                  : existing[key as keyof Task],
            ]),
          ) as never,
          ...(planned.success.reason ? { reason: planned.success.reason } : {}),
        };
        break;
      }
      case "project.create": {
        if (projects.has(command.projectId))
          return Result.fail(
            failure(
              "entity_conflict",
              index,
              "Project ID already exists",
              "projectId",
              command.projectId,
            ),
          );
        const planned = planProjectCreate([...projects.values()], command.input, context.actor);
        if (Result.isFailure(planned))
          return Result.fail(
            failure("reason_required", index, "Agent commands require a reason", "input.reason"),
          );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "project.created",
          projectId: command.projectId,
          title: planned.success.title,
          ...(planned.success.color !== null ? { color: planned.success.color } : {}),
          ...(planned.success.reason ? { reason: planned.success.reason } : {}),
        };
        break;
      }
      case "project.update": {
        const planned = planProjectUpdate([...projects.values()], command.input, context.actor);
        if (Result.isFailure(planned))
          return Result.fail(
            failure(
              planned.failure._tag === "AgentReasonRequired"
                ? "reason_required"
                : "missing_reference",
              index,
              planned.failure._tag,
              "input",
            ),
          );
        if (planned.success.kind === "noop") {
          noops.push({ commandIndex: index, reason: "unchanged" });
          break;
        }
        const existing = projects.get(command.input.projectId)!;
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "project.updated",
          projectId: existing.id,
          set: planned.success.set,
          prev: Object.fromEntries(
            Object.keys(planned.success.set).map((key) => [
              key,
              key === "archived"
                ? existing.archivedAt !== null
                : key === "description"
                  ? (existing.description ?? "")
                  : key === "targetDate"
                    ? (existing.targetDate ?? null)
                    : key === "bookmarks"
                      ? (existing.bookmarks ?? [])
                      : existing[key as keyof Project],
            ]),
          ) as never,
          ...(planned.success.reason ? { reason: planned.success.reason } : {}),
        };
        break;
      }
      case "page.create": {
        if (pages.has(command.pageId))
          return Result.fail(
            failure("entity_conflict", index, "Page ID already exists", "pageId", command.pageId),
          );
        if (command.input.projectId && !projects.has(command.input.projectId))
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Project does not exist",
              "input.projectId",
              command.input.projectId,
            ),
          );
        if (context.actor.kind === "agent" && !command.input.reason?.trim())
          return Result.fail(
            failure("reason_required", index, "Agent commands require a reason", "input.reason"),
          );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "page.created",
          pageId: command.pageId,
          projectId: command.input.projectId ?? null,
          kind: command.input.kind,
          title: command.input.title,
          body: command.input.body,
          pinned: command.input.pinned ?? false,
          ...(command.input.reason ? { reason: command.input.reason.trim() } : {}),
        };
        break;
      }
      case "page.update": {
        const current = pages.get(command.input.pageId);
        if (!current)
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Page does not exist",
              "input.pageId",
              command.input.pageId,
            ),
          );
        if (context.actor.kind === "agent" && !command.input.reason?.trim())
          return Result.fail(
            failure("reason_required", index, "Agent commands require a reason", "input.reason"),
          );
        const set: Record<string, unknown> = {};
        for (const key of ["title", "body", "pinned", "deleted"] as const)
          if (command.input[key] !== undefined) {
            const old = key === "deleted" ? current.deletedAt !== null : current[key];
            if (old !== command.input[key]) set[key] = command.input[key];
          }
        if (!Object.keys(set).length) {
          noops.push({ commandIndex: index, reason: "unchanged" });
          break;
        }
        const prev = Object.fromEntries(
          Object.keys(set).map((key) => [
            key,
            key === "deleted" ? current.deletedAt !== null : current[key as keyof Page],
          ]),
        );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "page.updated",
          pageId: current.id,
          set,
          prev,
          ...(command.input.reason ? { reason: command.input.reason.trim() } : {}),
        } as Event;
        break;
      }
      case "chat.create": {
        if (chats.has(command.chatId))
          return Result.fail(
            failure("entity_conflict", index, "Chat ID already exists", "chatId", command.chatId),
          );
        if (command.input.projectId && !projects.has(command.input.projectId))
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Project does not exist",
              "input.projectId",
              command.input.projectId,
            ),
          );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "chat.created",
          chatId: command.chatId,
          projectId: command.input.projectId,
          ...(command.input.title !== undefined ? { title: command.input.title } : {}),
        };
        break;
      }
      case "chat.message": {
        const current = chats.get(command.chatId);
        if (!current)
          return Result.fail(
            failure("missing_reference", index, "Chat does not exist", "chatId", command.chatId),
          );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "chat.message",
          chatId: command.chatId,
          messageId: command.messageId,
          role: command.role,
          text: command.text,
        };
        break;
      }
      case "chat.update": {
        const current = chats.get(command.input.chatId);
        if (!current)
          return Result.fail(
            failure(
              "missing_reference",
              index,
              "Chat does not exist",
              "input.chatId",
              command.input.chatId,
            ),
          );
        const set = Object.fromEntries(
          Object.keys(command.input)
            .filter((key) => {
              if (key === "chatId") return false;
              if (key === "headings")
                return (
                  JSON.stringify(command.input.headings) !== JSON.stringify(current.headings ?? [])
                );
              return (
                command.input[key as keyof typeof command.input] !== current[key as keyof Chat]
              );
            })
            .map((key) => [key, command.input[key as keyof typeof command.input]]),
        );
        if (!Object.keys(set).length) {
          noops.push({ commandIndex: index, reason: "unchanged" });
          break;
        }
        const prev = Object.fromEntries(
          Object.keys(set).map((key) => [
            key,
            key === "headings" ? (current.headings ?? []) : current[key as keyof Chat],
          ]),
        );
        event = {
          v: 1,
          id: ZERO_ID,
          at: INVALID_AT,
          by: context.actor,
          type: "chat.updated",
          chatId: current.id,
          set,
          prev,
        } as Event;
        break;
      }
    }
    if (event) {
      const draft = eventDraft(event, context);
      const decoded = Schema.decodeUnknownOption(EventSchema)({
        ...draft,
        id: ZERO_ID,
        at: INVALID_AT,
      });
      if (Option.isNone(decoded))
        return Result.fail(
          failure("invalid_command", index, "Planned event failed schema validation", "event"),
        );
      drafts.push(draft);
      stageEvent(event, projects, tasks, pages, chats, context.actor);
    }
  }
  return Result.succeed({ drafts, noops, finalSnapshot: { projects, tasks, pages, chats } });
}

/** Add caller supplied IDs and strictly increasing timestamps, validating the full batch. */
export function stampBatch(
  drafts: readonly EventDraft[],
  input: {
    readonly observedMaxAt?: string | null;
    readonly now: string;
    readonly eventIds: readonly EventId[];
  },
): Result.Result<readonly Event[], StampFailure> {
  if (input.eventIds.length !== drafts.length)
    return Result.fail({
      code: "id_count_mismatch",
      message: `Expected ${drafts.length} event IDs, received ${input.eventIds.length}`,
    });
  if (new Set(input.eventIds).size !== input.eventIds.length)
    return Result.fail({
      code: "invalid_event",
      message: "Event IDs must be unique within a batch",
    });
  if (
    !isIsoTimestamp(input.now) ||
    (input.observedMaxAt != null && !isIsoTimestamp(input.observedMaxAt))
  )
    return Result.fail({
      code: "invalid_clock",
      message: "Clock values must be valid ISO timestamps",
    });
  const events: Event[] = [];
  let previous = input.observedMaxAt ?? null;
  for (let index = 0; index < drafts.length; index += 1) {
    const at = nextAt(previous, input.now);
    const decoded = Schema.decodeUnknownOption(EventSchema)({
      ...drafts[index],
      id: input.eventIds[index],
      at,
    });
    if (Option.isNone(decoded))
      return Result.fail({
        code: "invalid_event",
        eventIndex: index,
        message: "Draft failed event schema validation",
      });
    events.push(decoded.value);
    previous = at;
  }
  return Result.succeed(events);
}

function isIsoTimestamp(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function stageEvent(
  event: Event,
  projects: Map<ProjectId, Project>,
  tasks: Map<TaskId, Task>,
  pages: Map<PageId, Page>,
  chats: Map<ChatId, Chat>,
  actor: Actor,
): void {
  switch (event.type) {
    case "project.created":
      projects.set(event.projectId, {
        id: event.projectId,
        title: event.title,
        color: event.color ?? null,
        description: "",
        targetDate: null,
        bookmarks: [],
        archivedAt: null,
        createdAt: INVALID_AT,
        updatedAt: INVALID_AT,
      });
      break;
    case "project.updated": {
      const current = projects.get(event.projectId);
      if (!current) break;
      projects.set(event.projectId, {
        ...current,
        title: event.set.title ?? current.title,
        color: event.set.color !== undefined ? event.set.color : current.color,
        description: event.set.description ?? current.description ?? "",
        targetDate:
          event.set.targetDate !== undefined ? event.set.targetDate : (current.targetDate ?? null),
        bookmarks: event.set.bookmarks ?? current.bookmarks ?? [],
        archivedAt:
          event.set.archived === true
            ? (current.archivedAt ?? INVALID_AT)
            : event.set.archived === false
              ? null
              : current.archivedAt,
        updatedAt: INVALID_AT,
      });
      break;
    }
    case "task.created":
      tasks.set(event.taskId, {
        id: event.taskId,
        projectId: event.projectId,
        title: event.title,
        tags: event.tags ?? [],
        notes: event.notes ?? "",
        dueDate: event.dueDate ?? null,
        status: event.status,
        quadrant: event.quadrant,
        position: event.position,
        createdAt: INVALID_AT,
        createdBy: actor,
        updatedAt: INVALID_AT,
        completedAt: null,
        deletedAt: null,
        lastReason: event.reason ?? null,
      });
      break;
    case "task.updated": {
      const current = tasks.get(event.taskId);
      if (!current) break;
      const status = event.set.status ?? current.status;
      tasks.set(event.taskId, {
        ...current,
        projectId: event.set.projectId !== undefined ? event.set.projectId : current.projectId,
        title: event.set.title ?? current.title,
        tags: event.set.tags ?? current.tags ?? [],
        notes: event.set.notes ?? current.notes,
        dueDate: event.set.dueDate !== undefined ? event.set.dueDate : current.dueDate,
        status,
        quadrant: event.set.quadrant !== undefined ? event.set.quadrant : current.quadrant,
        position: event.set.position ?? current.position,
        deletedAt:
          event.set.deleted === true
            ? (current.deletedAt ?? INVALID_AT)
            : event.set.deleted === false
              ? null
              : current.deletedAt,
        completedAt:
          status === "done"
            ? (current.completedAt ?? INVALID_AT)
            : status !== current.status
              ? null
              : current.completedAt,
        updatedAt: INVALID_AT,
        lastReason: event.reason ?? current.lastReason,
      });
      break;
    }
    case "page.created":
      pages.set(event.pageId, {
        id: event.pageId,
        projectId: event.projectId,
        kind: event.kind,
        title: event.title,
        body: event.body,
        pinned: event.pinned ?? false,
        createdAt: INVALID_AT,
        updatedAt: INVALID_AT,
        deletedAt: null,
        lastReason: event.reason ?? null,
      });
      break;
    case "page.updated": {
      const current = pages.get(event.pageId);
      if (!current) break;
      pages.set(event.pageId, {
        ...current,
        title: event.set.title ?? current.title,
        body: event.set.body ?? current.body,
        pinned: event.set.pinned ?? current.pinned,
        deletedAt:
          event.set.deleted === true
            ? (current.deletedAt ?? INVALID_AT)
            : event.set.deleted === false
              ? null
              : current.deletedAt,
        updatedAt: INVALID_AT,
        lastReason: event.reason ?? current.lastReason,
      });
      break;
    }
    case "chat.created":
      chats.set(event.chatId, {
        id: event.chatId,
        projectId: event.projectId,
        title: event.title ?? null,
        summary: null,
        headings: [],
        messages: [],
        createdAt: INVALID_AT,
        updatedAt: INVALID_AT,
      });
      break;
    case "chat.updated": {
      const current = chats.get(event.chatId);
      if (!current) break;
      chats.set(event.chatId, {
        ...current,
        title: event.set.title !== undefined ? event.set.title : current.title,
        summary: event.set.summary !== undefined ? event.set.summary : current.summary,
        headings: event.set.headings ?? current.headings ?? [],
        updatedAt: INVALID_AT,
      });
      break;
    }
    case "chat.message": {
      const current = chats.get(event.chatId);
      if (!current) break;
      const messages = current.messages.filter((message) => message.id !== event.messageId);
      chats.set(event.chatId, {
        ...current,
        messages: [
          ...messages,
          { id: event.messageId, role: event.role, text: event.text, at: INVALID_AT },
        ],
        updatedAt: INVALID_AT,
      });
      break;
    }
  }
}
