// Copyright (c) T3 Tools / MIT — adapted for Yatma
import {
  type Actor,
  type ApplyChangeOp,
  type BatchId,
  type Chat,
  type ChatId,
  type Event,
  type Page,
  type PageId,
  type Project,
  type ProjectId,
  type SyncPushResult,
  type Task,
  type TaskId,
  BatchId as BatchIdSchema,
  ChatId as ChatIdSchema,
  PageId as PageIdSchema,
  ProjectId as ProjectIdSchema,
  TaskId as TaskIdSchema,
  generateEventId,
  generateShortId,
  isOpenTask,
  planCreate,
  planProjectCreate,
  planProjectUpdate,
  planUndo,
  planUpdate,
  sortTasksByPosition,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as EventStore from "../eventStore.ts";

export type ToolActorContext = {
  readonly actor: Actor;
  readonly batchId: BatchId;
  readonly nowIso: string;
};

export type ListTasksInput = {
  projectId?: ProjectId | null;
  status?: Task["status"];
  quadrant?: Task["quadrant"];
  includeRecentDone?: boolean;
  limit?: number;
};

export type SearchHit =
  | { readonly kind: "task"; readonly id: TaskId; readonly title: string; readonly snippet: string }
  | { readonly kind: "page"; readonly id: PageId; readonly title: string; readonly snippet: string }
  | {
      readonly kind: "chat";
      readonly id: ChatId;
      readonly title: string | null;
      readonly snippet: string;
    };

export type ReadResult =
  | { readonly kind: "task"; readonly task: Task; readonly history: readonly Event[] }
  | { readonly kind: "page"; readonly page: Page }
  | {
      readonly kind: "chat";
      readonly chatId: ChatId;
      readonly title: string | null;
      readonly summary: string | null;
    };

export type ApplyChangesSuccess = {
  readonly batchId: BatchId;
  readonly events: readonly Event[];
  readonly summary: string;
};

export type WritePageSuccess = {
  readonly page: Page;
  readonly events: readonly Event[];
};

export type ToolFailure = { readonly _tag: "ToolFailure"; readonly message: string };

function fail(message: string): ToolFailure {
  return { _tag: "ToolFailure", message };
}

/** Stamp server-assigned seq onto events that were accepted in a push. */
function attachAssignedSeqs(
  events: readonly Event[],
  result: SyncPushResult,
): Event[] {
  const seqById = new Map(result.assigned.map((row) => [row.id, row.seq]));
  return events
    .filter((event) => seqById.has(event.id))
    .map((event) => ({ ...event, seq: seqById.get(event.id)! }));
}

/** List open (or filtered) tasks in global priority order. */
export const listTasks = Effect.fn("AgentTools.listTasks")(function* (input: ListTasksInput = {}) {
  const folded = yield* EventStore.loadFolded;
  let tasks = [...folded.tasks.values()];
  if (input.projectId !== undefined) {
    tasks = tasks.filter((task) => task.projectId === input.projectId);
  }
  if (input.status) {
    tasks = tasks.filter((task) => task.status === input.status);
  }
  if (input.quadrant !== undefined) {
    tasks = tasks.filter((task) => task.quadrant === input.quadrant);
  }
  if (!input.includeRecentDone) {
    tasks = tasks.filter(isOpenTask);
  }
  const sorted = sortTasksByPosition(tasks);
  const limit = input.limit ?? 100;
  return { tasks: sorted.slice(0, limit) };
});

/** FTS5 search over tasks, pages, and chat summaries. */
export const search = Effect.fn("AgentTools.search")(function* (input: {
  readonly query: string;
  readonly limit?: number;
}) {
  const folded = yield* EventStore.loadFolded;
  const rows = yield* EventStore.searchFts(input.query);
  const limit = input.limit ?? 20;
  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (hits.length >= limit) break;
    if (row.kind === "task") {
      const id = TaskIdSchema.make(row.entity_id);
      const task = folded.tasks.get(id);
      hits.push({
        kind: "task",
        id,
        title: task?.title ?? row.title,
        snippet: task?.notes?.slice(0, 120) ?? row.title,
      });
      continue;
    }
    if (row.kind === "page") {
      const id = PageIdSchema.make(row.entity_id);
      const page = folded.pages.get(id);
      hits.push({
        kind: "page",
        id,
        title: page?.title ?? row.title,
        snippet: page?.body?.slice(0, 120) ?? row.title,
      });
      continue;
    }
    if (row.kind === "chat") {
      const id = ChatIdSchema.make(row.entity_id);
      const chat = folded.chats.get(id);
      hits.push({
        kind: "chat",
        id,
        title: chat?.title ?? null,
        snippet: chat?.summary ?? row.title,
      });
    }
  }
  return { hits };
});

/** Read a task (+ history), page, or chat summary. */
export const read = Effect.fn("AgentTools.read")(function* (
  input:
    | { readonly kind: "task"; readonly taskId: TaskId }
    | { readonly kind: "page"; readonly pageId: PageId }
    | { readonly kind: "chat"; readonly chatId: ChatId },
) {
  const folded = yield* EventStore.loadFolded;
  if (input.kind === "task") {
    const task = folded.tasks.get(input.taskId);
    if (!task) return fail(`task not found: ${input.taskId}`);
    const history = yield* EventStore.eventsForEntity(input.taskId);
    return { kind: "task" as const, task, history } satisfies ReadResult;
  }
  if (input.kind === "page") {
    const page = folded.pages.get(input.pageId);
    if (!page) return fail(`page not found: ${input.pageId}`);
    return { kind: "page" as const, page } satisfies ReadResult;
  }
  const chat = folded.chats.get(input.chatId);
  if (!chat) return fail(`chat not found: ${input.chatId}`);
  return {
    kind: "chat" as const,
    chatId: input.chatId,
    title: chat.title,
    summary: chat.summary,
  } satisfies ReadResult;
});

type PlannedEvent =
  | { readonly kind: "event"; readonly event: Event }
  | { readonly kind: "noop"; readonly label: string };

function summarizeOps(ops: readonly ApplyChangeOp[], eventCount: number): string {
  const counts = {
    create_task: 0,
    update_task: 0,
    start_task: 0,
    complete_task: 0,
    create_project: 0,
    update_project: 0,
    undo_batch: 0,
  };
  for (const op of ops) {
    counts[op.op] += 1;
  }
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([op, n]) => `${n} ${op}`);
  return parts.length > 0
    ? `${parts.join(", ")} → ${eventCount} event${eventCount === 1 ? "" : "s"}`
    : "No changes";
}

function prevFromTask(task: Task, set: Record<string, unknown>): Record<string, unknown> {
  const prev: Record<string, unknown> = {};
  for (const key of Object.keys(set)) {
    if (key === "deleted") {
      prev.deleted = task.deletedAt !== null;
    } else {
      prev[key] = task[key as keyof Task];
    }
  }
  return prev;
}

function prevFromProject(project: Project, set: Record<string, unknown>): Record<string, unknown> {
  const prev: Record<string, unknown> = {};
  for (const key of Object.keys(set)) {
    if (key === "archived") {
      prev.archived = project.archivedAt !== null;
    } else {
      prev[key] = project[key as keyof Project];
    }
  }
  return prev;
}

/**
 * Plan and append one apply_changes batch via core rules → EventStore.
 * All-or-nothing: any planning failure writes nothing.
 */
export const applyChanges = Effect.fn("AgentTools.applyChanges")(function* (
  input: { readonly reason: string; readonly ops: readonly ApplyChangeOp[] },
  ctx: ToolActorContext,
) {
  if (input.ops.length === 0) return fail("ops must be non-empty");

  const folded = yield* EventStore.loadFolded;
  let tasks = [...folded.tasks.values()];
  let projects = [...folded.projects.values()];
  const planned: PlannedEvent[] = [];

  for (const op of input.ops) {
    if (op.op === "create_task") {
      const result = planCreate(
        tasks,
        {
          title: op.title,
          notes: op.notes,
          projectId: op.projectId ?? null,
          reason: input.reason,
        },
        ctx.actor,
      );
      if (Result.isFailure(result)) return fail(result.failure._tag);
      const taskId = TaskIdSchema.make(generateShortId("t_"));
      const created: Event = {
        v: 1,
        type: "task.created",
        id: generateEventId(),
        at: ctx.nowIso,
        by: ctx.actor,
        reason: input.reason,
        batch: ctx.batchId,
        taskId,
        projectId: result.success.projectId,
        title: result.success.title,
        notes: result.success.notes,
        status: result.success.status,
        quadrant: result.success.quadrant,
        position: result.success.position,
      };
      planned.push({ kind: "event", event: created });
      tasks = [
        ...tasks,
        {
          id: taskId,
          projectId: result.success.projectId,
          title: result.success.title,
          notes: result.success.notes,
          dueDate: null,
          status: result.success.status,
          quadrant: result.success.quadrant,
          position: result.success.position,
          createdAt: ctx.nowIso,
          createdBy: ctx.actor,
          updatedAt: ctx.nowIso,
          completedAt: null,
          deletedAt: null,
          lastReason: input.reason,
        },
      ];
      continue;
    }

    if (op.op === "update_task" || op.op === "start_task" || op.op === "complete_task") {
      const taskId = op.op === "update_task" ? op.taskId : op.taskId;
      const updateInput =
        op.op === "start_task"
          ? { taskId, status: "in_progress" as const, reason: input.reason }
          : op.op === "complete_task"
            ? { taskId, status: "done" as const, reason: input.reason }
            : {
                taskId: op.taskId,
                title: op.title,
                notes: op.notes,
                status: op.status,
                quadrant: op.quadrant,
                placement: op.placement,
                projectId: op.projectId,
                deleted: op.deleted,
                reason: input.reason,
              };
      const result = planUpdate(tasks, updateInput, ctx.actor);
      if (Result.isFailure(result)) return fail(result.failure._tag);
      if (result.success.kind === "noop") {
        planned.push({ kind: "noop", label: `noop ${taskId}` });
        continue;
      }
      const plannedUpdate = result.success;
      const current = tasks.find((task) => task.id === taskId)!;
      const set = plannedUpdate.set as Record<string, unknown>;
      const updated: Event = {
        v: 1,
        type: "task.updated",
        id: generateEventId(),
        at: ctx.nowIso,
        by: ctx.actor,
        reason: input.reason,
        batch: ctx.batchId,
        taskId,
        set: plannedUpdate.set,
        prev: prevFromTask(current, set) as never,
      };
      planned.push({ kind: "event", event: updated });
      tasks = tasks.map((task) => (task.id === taskId ? plannedUpdate.next : task));
      continue;
    }

    if (op.op === "create_project") {
      const result = planProjectCreate(
        projects,
        { title: op.title, color: op.color, reason: input.reason },
        ctx.actor,
      );
      if (Result.isFailure(result)) return fail(result.failure._tag);
      const projectId = ProjectIdSchema.make(generateShortId("p_"));
      const created: Event = {
        v: 1,
        type: "project.created",
        id: generateEventId(),
        at: ctx.nowIso,
        by: ctx.actor,
        reason: input.reason,
        batch: ctx.batchId,
        projectId,
        title: result.success.title,
        color: result.success.color,
      };
      planned.push({ kind: "event", event: created });
      projects = [
        ...projects,
        {
          id: projectId,
          title: result.success.title,
          color: result.success.color,
          archivedAt: null,
          createdAt: ctx.nowIso,
          updatedAt: ctx.nowIso,
        },
      ];
      continue;
    }

    if (op.op === "update_project") {
      const result = planProjectUpdate(
        projects,
        {
          projectId: op.projectId,
          title: op.title,
          color: op.color,
          archived: op.archived,
          reason: input.reason,
        },
        ctx.actor,
      );
      if (Result.isFailure(result)) return fail(result.failure._tag);
      if (result.success.kind === "noop") {
        planned.push({ kind: "noop", label: `noop ${op.projectId}` });
        continue;
      }
      const plannedProject = result.success;
      const current = projects.find((project) => project.id === op.projectId)!;
      const set = plannedProject.set as Record<string, unknown>;
      const updated: Event = {
        v: 1,
        type: "project.updated",
        id: generateEventId(),
        at: ctx.nowIso,
        by: ctx.actor,
        reason: input.reason,
        batch: ctx.batchId,
        projectId: op.projectId,
        set: plannedProject.set,
        prev: prevFromProject(current, set) as never,
      };
      planned.push({ kind: "event", event: updated });
      projects = projects.map((project) =>
        project.id === op.projectId ? plannedProject.next : project,
      );
      continue;
    }

    // undo_batch
    const batchEvents = yield* EventStore.eventsForBatch(op.batchId);
    if (batchEvents.length === 0) return fail(`batch not found: ${op.batchId}`);
    const undo = planUndo(batchEvents, {
      projects: new Map(projects.map((project) => [project.id, project])),
      tasks: new Map(tasks.map((task) => [task.id, task])),
      pages: folded.pages,
      chats: folded.chats,
    });
    for (const revert of undo.reverts) {
      if (revert.type === "task.updated") {
        const current = tasks.find((task) => task.id === revert.taskId);
        if (!current) continue;
        const set = revert.set as Record<string, unknown>;
        const event: Event = {
          v: 1,
          type: "task.updated",
          id: generateEventId(),
          at: ctx.nowIso,
          by: ctx.actor,
          reason: input.reason,
          batch: ctx.batchId,
          undoes: BatchIdSchema.make(op.batchId),
          taskId: revert.taskId,
          set: revert.set,
          prev: prevFromTask(current, set) as never,
        };
        planned.push({ kind: "event", event });
        const plannedUpdate = planUpdate(
          tasks,
          { taskId: revert.taskId, ...revert.set, reason: input.reason },
          ctx.actor,
        );
        if (Result.isSuccess(plannedUpdate) && plannedUpdate.success.kind === "update") {
          const nextTask = plannedUpdate.success.next;
          tasks = tasks.map((task) => (task.id === revert.taskId ? nextTask : task));
        }
      } else if (revert.type === "project.updated") {
        const current = projects.find((project) => project.id === revert.projectId);
        if (!current) continue;
        const set = revert.set as Record<string, unknown>;
        const event: Event = {
          v: 1,
          type: "project.updated",
          id: generateEventId(),
          at: ctx.nowIso,
          by: ctx.actor,
          reason: input.reason,
          batch: ctx.batchId,
          undoes: BatchIdSchema.make(op.batchId),
          projectId: revert.projectId,
          set: revert.set,
          prev: prevFromProject(current, set) as never,
        };
        planned.push({ kind: "event", event });
        const plannedUpdate = planProjectUpdate(
          projects,
          { projectId: revert.projectId, ...revert.set, reason: input.reason },
          ctx.actor,
        );
        if (Result.isSuccess(plannedUpdate) && plannedUpdate.success.kind === "update") {
          const nextProject = plannedUpdate.success.next;
          projects = projects.map((project) =>
            project.id === revert.projectId ? nextProject : project,
          );
        }
      } else if (revert.type === "page.updated") {
        const page = folded.pages.get(revert.pageId);
        if (!page) continue;
        const set = revert.set as Record<string, unknown>;
        const prev: Record<string, unknown> = {};
        for (const key of Object.keys(set)) {
          if (key === "deleted") prev.deleted = page.deletedAt !== null;
          else prev[key] = page[key as keyof Page];
        }
        planned.push({
          kind: "event",
          event: {
            v: 1,
            type: "page.updated",
            id: generateEventId(),
            at: ctx.nowIso,
            by: ctx.actor,
            reason: input.reason,
            batch: ctx.batchId,
            undoes: BatchIdSchema.make(op.batchId),
            pageId: revert.pageId,
            set: revert.set,
            prev: prev as never,
          },
        });
      } else if (revert.type === "chat.updated") {
        const chat = folded.chats.get(revert.chatId);
        if (!chat) continue;
        const set = revert.set as Record<string, unknown>;
        const prev: Record<string, unknown> = {};
        for (const key of Object.keys(set)) {
          prev[key] = chat[key as keyof Chat];
        }
        planned.push({
          kind: "event",
          event: {
            v: 1,
            type: "chat.updated",
            id: generateEventId(),
            at: ctx.nowIso,
            by: ctx.actor,
            reason: input.reason,
            batch: ctx.batchId,
            undoes: BatchIdSchema.make(op.batchId),
            chatId: revert.chatId,
            set: revert.set,
            prev: prev as never,
          },
        });
      }
    }
  }

  const events = planned
    .filter((item): item is { readonly kind: "event"; readonly event: Event } => item.kind === "event")
    .map((item) => item.event);

  if (events.length === 0) {
    return {
      batchId: ctx.batchId,
      events: [],
      summary: "No changes",
    } satisfies ApplyChangesSuccess;
  }

  const push = yield* EventStore.pushEvents(events, ctx.nowIso);
  if (!push.ok) {
    return fail(
      push.reject._tag === "clock_skew"
        ? `clock_skew: ${push.reject.id}`
        : push.reject.reason,
    );
  }

  return {
    batchId: ctx.batchId,
    events: attachAssignedSeqs(events, push.result),
    summary: summarizeOps(input.ops, push.result.accepted.length),
  } satisfies ApplyChangesSuccess;
});

/** Create or replace a page / brief. */
export type WritePageInput = {
  readonly pageId?: PageId;
  readonly projectId: ProjectId | null;
  readonly kind: Page["kind"];
  readonly title: string;
  readonly body: string;
  readonly pinned?: boolean;
  readonly reason: string;
};

export const writePage = Effect.fn("AgentTools.writePage")(function* (
  input: WritePageInput,
  ctx: ToolActorContext,
) {
  const folded = yield* EventStore.loadFolded;
  const events: Event[] = [];
  let page: Page;

  if (input.pageId) {
    const current = folded.pages.get(input.pageId);
    if (!current) return fail(`page not found: ${input.pageId}`);
    const set: {
      title?: string;
      body?: string;
      pinned?: boolean;
    } = {};
    if (input.title !== current.title) set.title = input.title;
    if (input.body !== current.body) set.body = input.body;
    if (input.pinned !== undefined && input.pinned !== current.pinned) {
      set.pinned = input.pinned;
    }
    if (Object.keys(set).length === 0) {
      return { page: current, events: [] } satisfies WritePageSuccess;
    }
    const prev: Record<string, unknown> = {};
    for (const key of Object.keys(set)) {
      prev[key] = current[key as keyof Page];
    }
    const event: Event = {
      v: 1,
      type: "page.updated",
      id: generateEventId(),
      at: ctx.nowIso,
      by: ctx.actor,
      reason: input.reason,
      batch: ctx.batchId,
      pageId: input.pageId,
      set,
      prev: prev as never,
    };
    events.push(event);
    page = {
      ...current,
      title: set.title ?? current.title,
      body: set.body ?? current.body,
      pinned: set.pinned ?? current.pinned,
      updatedAt: ctx.nowIso,
      lastReason: input.reason,
    };
  } else {
    const pageId = PageIdSchema.make(generateShortId("pg_"));
    const event: Event = {
      v: 1,
      type: "page.created",
      id: generateEventId(),
      at: ctx.nowIso,
      by: ctx.actor,
      reason: input.reason,
      batch: ctx.batchId,
      pageId,
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      pinned: input.pinned ?? false,
    };
    events.push(event);
    page = {
      id: pageId,
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      pinned: input.pinned ?? false,
      createdAt: ctx.nowIso,
      updatedAt: ctx.nowIso,
      deletedAt: null,
      lastReason: input.reason,
    };
  }

  const push = yield* EventStore.pushEvents(events, ctx.nowIso);
  if (!push.ok) {
    return fail(
      push.reject._tag === "clock_skew"
        ? `clock_skew: ${push.reject.id}`
        : push.reject.reason,
    );
  }
  return { page, events: attachAssignedSeqs(events, push.result) } satisfies WritePageSuccess;
});

export function isToolFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { _tag: string })._tag === "ToolFailure"
  );
}

/** Fresh batch id for one agent write turn. */
export function newBatchId(): BatchId {
  return BatchIdSchema.make(`batch_${generateShortId("t_").slice(2)}`);
}
