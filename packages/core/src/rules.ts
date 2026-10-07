// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { orderKeyBetween } from "./orderKey.ts";
import type { ProjectId, TaskId } from "./ids.ts";
import type {
  Actor,
  Placement,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectUpdatedFields,
  Quadrant,
  Task,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
  TaskUpdatedFields,
} from "./schemas.ts";

const QUADRANT_RANK: ReadonlyRecord<Quadrant | "inbox", number> = {
  do: 0,
  schedule: 1,
  delegate: 2,
  eliminate: 3,
  inbox: 4,
};

type ReadonlyRecord<K extends string, V> = { readonly [P in K]: V };

export type OpenTask = Task & { readonly deletedAt: null };

export function isOpenTask(task: Task): task is OpenTask {
  return task.deletedAt === null && task.status !== "done";
}

export function isVisibleInSnapshot(task: Task, nowMs: number, recentMs: number): boolean {
  if (task.deletedAt === null && task.status !== "done") return true;
  const stamp = task.deletedAt ?? task.completedAt ?? task.updatedAt;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return false;
  return nowMs - ms <= recentMs;
}

function quadrantBucket(task: Task): Quadrant | "inbox" {
  return task.quadrant ?? "inbox";
}

/** Open tasks sorted by position (global priority list). */
export function sortTasksByPosition(tasks: readonly Task[]): Task[] {
  return [...tasks].toSorted((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function openSorted(tasks: readonly Task[]): OpenTask[] {
  return sortTasksByPosition(tasks).filter(isOpenTask);
}

function keyBetweenNeighbors(
  before: string | null,
  after: string | null,
  reserved: ReadonlySet<string>,
): string {
  let key = orderKeyBetween(before, after);
  while (key !== null && reserved.has(key)) {
    key = orderKeyBetween(key, after);
  }
  if (key !== null) return key;
  const fallback = orderKeyBetween(before, null) ?? orderKeyBetween(null, after) ?? "n";
  if (!reserved.has(fallback)) return fallback;
  let probe: string | null = fallback;
  for (let i = 0; i < 32 && probe !== null; i += 1) {
    probe = orderKeyBetween(probe, null);
    if (probe !== null && !reserved.has(probe)) return probe;
  }
  return `${fallback}n`;
}

function reservedPositions(tasks: readonly Task[], excludeId?: TaskId): Set<string> {
  const reserved = new Set<string>();
  for (const task of tasks) {
    if (excludeId !== undefined && task.id === excludeId) continue;
    if (task.deletedAt !== null) continue;
    reserved.add(task.position);
  }
  return reserved;
}

export function resolveExplicitPlacement(
  tasks: readonly Task[],
  placement: Placement,
  excludeId?: TaskId,
): string {
  const open = openSorted(tasks).filter((task) => task.id !== excludeId);
  const reserved = reservedPositions(tasks, excludeId);
  if (placement.kind === "top") {
    const first = open[0] ?? null;
    return keyBetweenNeighbors(null, first?.position ?? null, reserved);
  }
  if (placement.kind === "bottom") {
    const last = open.at(-1) ?? null;
    return keyBetweenNeighbors(last?.position ?? null, null, reserved);
  }
  const anchor = tasks.find((task) => task.id === placement.taskId);
  if (!anchor || anchor.deletedAt !== null) {
    const last = open.at(-1) ?? null;
    return keyBetweenNeighbors(last?.position ?? null, null, reserved);
  }
  if (placement.kind === "before") {
    const before = open.filter((task) => task.position < anchor.position).at(-1) ?? null;
    return keyBetweenNeighbors(before?.position ?? null, anchor.position, reserved);
  }
  const after = open.find((task) => task.position > anchor.position) ?? null;
  return keyBetweenNeighbors(anchor.position, after?.position ?? null, reserved);
}

/**
 * Position for a To do task after triage into a quadrant (or back to Inbox).
 * Doing/Done tasks keep their position when only the quadrant changes.
 */
export function resolveTriagePosition(
  tasks: readonly Task[],
  taskId: TaskId,
  nextQuadrant: Quadrant | null,
): string | null {
  const current = tasks.find((task) => task.id === taskId);
  if (!current || current.deletedAt !== null) return null;
  if (current.status !== "todo") return null;

  if (nextQuadrant === null) {
    return resolveExplicitPlacement(tasks, { kind: "bottom" }, taskId);
  }

  const open = openSorted(tasks).filter((task) => task.id !== taskId);
  const reserved = reservedPositions(tasks, taskId);
  const nextRank = QUADRANT_RANK[nextQuadrant];

  const sameQuadrantTodos = open.filter(
    (task) => task.status === "todo" && quadrantBucket(task) === nextQuadrant,
  );
  if (sameQuadrantTodos.length > 0) {
    const last = sameQuadrantTodos.at(-1)!;
    const after = open.find((task) => task.position > last.position) ?? null;
    return keyBetweenNeighbors(last.position, after?.position ?? null, reserved);
  }

  const lowerTodo = open.find(
    (task) => task.status === "todo" && QUADRANT_RANK[quadrantBucket(task)] > nextRank,
  );
  if (lowerTodo) {
    const before = open.filter((task) => task.position < lowerTodo.position).at(-1) ?? null;
    return keyBetweenNeighbors(before?.position ?? null, lowerTodo.position, reserved);
  }

  return resolveExplicitPlacement(tasks, { kind: "bottom" }, taskId);
}

export function resolveStartPosition(tasks: readonly Task[], taskId: TaskId): string {
  return resolveExplicitPlacement(tasks, { kind: "top" }, taskId);
}

export class AgentReasonRequired extends Schema.TaggedError<AgentReasonRequired>()(
  "AgentReasonRequired",
  {},
) {}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  taskId: Schema.String,
}) {}

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.String,
}) {}

export type PlannedCreate = {
  readonly title: string;
  readonly notes: string;
  readonly projectId: ProjectId | null;
  readonly status: "todo";
  readonly quadrant: null;
  readonly position: string;
  readonly reason: string | undefined;
};

export type PlannedUpdate =
  | { readonly kind: "noop" }
  | {
      readonly kind: "update";
      readonly set: TaskUpdatedFields;
      readonly reason: string | undefined;
      readonly next: Task;
    };

export type PlannedProjectCreate = {
  readonly title: string;
  readonly color: string | null;
  readonly reason: string | undefined;
};

export type PlannedProjectUpdate =
  | { readonly kind: "noop" }
  | {
      readonly kind: "update";
      readonly set: ProjectUpdatedFields;
      readonly reason: string | undefined;
      readonly next: Project;
    };

function requireAgentReason(
  actor: Actor,
  reason: string | undefined,
): Result.Result<string | undefined, AgentReasonRequired> {
  if (actor.kind !== "agent") return Result.succeed(reason);
  const trimmed = reason?.trim();
  if (!trimmed) return Result.fail(new AgentReasonRequired());
  return Result.succeed(trimmed);
}

export function planCreate(
  tasks: readonly Task[],
  input: TaskCreateInput,
  actor: Actor,
): Result.Result<PlannedCreate, AgentReasonRequired> {
  return Result.map(requireAgentReason(actor, input.reason), (reason) => ({
    title: input.title,
    notes: input.notes ?? "",
    projectId: input.projectId ?? null,
    status: "todo" as const,
    quadrant: null,
    position: resolveExplicitPlacement(tasks, { kind: "bottom" }),
    reason,
  }));
}

export function planUpdate(
  tasks: readonly Task[],
  input: TaskUpdateInput,
  actor: Actor,
): Result.Result<PlannedUpdate, AgentReasonRequired | TaskNotFound> {
  const current = tasks.find((task) => task.id === input.taskId);
  if (!current) {
    return Result.fail(new TaskNotFound({ taskId: input.taskId }));
  }

  const reasonResult = requireAgentReason(actor, input.reason);
  if (Result.isFailure(reasonResult)) {
    return Result.fail(reasonResult.failure);
  }
  const reason = reasonResult.success;

  const set: {
    projectId?: ProjectId | null;
    title?: string;
    notes?: string;
    dueDate?: string | null;
    status?: TaskStatus;
    quadrant?: Quadrant | null;
    position?: string;
    deleted?: boolean;
  } = {};

  if (input.projectId !== undefined && input.projectId !== current.projectId) {
    set.projectId = input.projectId;
  }
  if (input.title !== undefined && input.title !== current.title) set.title = input.title;
  if (input.notes !== undefined && input.notes !== current.notes) set.notes = input.notes;
  if (input.dueDate !== undefined && input.dueDate !== current.dueDate) set.dueDate = input.dueDate;

  const nextStatus = input.status ?? current.status;
  if (input.status !== undefined && input.status !== current.status) {
    set.status = input.status;
  }

  if (input.quadrant !== undefined && input.quadrant !== current.quadrant) {
    set.quadrant = input.quadrant;
  }

  if (input.deleted === true && current.deletedAt === null) set.deleted = true;
  if (input.deleted === false && current.deletedAt !== null) set.deleted = false;

  let nextPosition = current.position;
  if (input.placement !== undefined) {
    nextPosition = resolveExplicitPlacement(tasks, input.placement, current.id);
  } else if (
    input.status === "in_progress" &&
    current.status !== "in_progress" &&
    current.deletedAt === null &&
    (input.deleted === undefined || input.deleted === false)
  ) {
    nextPosition = resolveStartPosition(tasks, current.id);
  } else if (
    input.quadrant !== undefined &&
    input.quadrant !== current.quadrant &&
    nextStatus === "todo" &&
    (current.deletedAt === null || input.deleted === false)
  ) {
    const triaged = resolveTriagePosition(tasks, current.id, input.quadrant);
    if (triaged !== null) nextPosition = triaged;
  }

  if (nextPosition !== current.position) set.position = nextPosition;

  if (Object.keys(set).length === 0) return Result.succeed({ kind: "noop" });

  const next: Task = {
    ...current,
    projectId: set.projectId !== undefined ? set.projectId : current.projectId,
    title: set.title ?? current.title,
    notes: set.notes ?? current.notes,
    dueDate: set.dueDate !== undefined ? set.dueDate : current.dueDate,
    status: set.status ?? current.status,
    quadrant: set.quadrant !== undefined ? set.quadrant : current.quadrant,
    position: set.position ?? current.position,
    deletedAt:
      set.deleted === true
        ? (current.deletedAt ?? new Date(0).toISOString())
        : set.deleted === false
          ? null
          : current.deletedAt,
    completedAt:
      (set.status ?? current.status) === "done"
        ? (current.completedAt ?? new Date(0).toISOString())
        : set.status !== undefined && set.status !== "done"
          ? null
          : current.completedAt,
    lastReason: reason ?? current.lastReason,
  };

  return Result.succeed({ kind: "update", set, reason, next });
}

/** Stub: validates agent reason and returns create fields. */
export function planProjectCreate(
  _projects: readonly Project[],
  input: ProjectCreateInput,
  actor: Actor,
): Result.Result<PlannedProjectCreate, AgentReasonRequired> {
  return Result.map(requireAgentReason(actor, input.reason), (reason) => ({
    title: input.title,
    color: input.color ?? null,
    reason,
  }));
}

/** Stub: no-op when nothing changes; otherwise returns the field set. */
export function planProjectUpdate(
  projects: readonly Project[],
  input: ProjectUpdateInput,
  actor: Actor,
): Result.Result<PlannedProjectUpdate, AgentReasonRequired | ProjectNotFound> {
  const current = projects.find((project) => project.id === input.projectId);
  if (!current) {
    return Result.fail(new ProjectNotFound({ projectId: input.projectId }));
  }

  const reasonResult = requireAgentReason(actor, input.reason);
  if (Result.isFailure(reasonResult)) {
    return Result.fail(reasonResult.failure);
  }
  const reason = reasonResult.success;

  const set: {
    title?: string;
    color?: string | null;
    archived?: boolean;
  } = {};
  if (input.title !== undefined && input.title !== current.title) set.title = input.title;
  if (input.color !== undefined && input.color !== current.color) set.color = input.color;
  if (input.archived === true && current.archivedAt === null) set.archived = true;
  if (input.archived === false && current.archivedAt !== null) set.archived = false;

  if (Object.keys(set).length === 0) return Result.succeed({ kind: "noop" });

  const next: Project = {
    ...current,
    title: set.title ?? current.title,
    color: set.color !== undefined ? set.color : current.color,
    archivedAt:
      set.archived === true
        ? (current.archivedAt ?? new Date(0).toISOString())
        : set.archived === false
          ? null
          : current.archivedAt,
  };

  return Result.succeed({ kind: "update", set: set as ProjectUpdatedFields, reason, next });
}
