import type {
  Event,
  FoldedEntities,
  ProjectId,
  Task,
  TaskId,
  TaskUpdateInput,
  TaskUpdatedFields,
} from "@yatma/core";
import {
  DeviceId,
  generateEventId,
  generateShortId,
  nextAt,
  planCreate,
  planProjectCreate,
  planUpdate,
  ProjectId as ProjectIdSchema,
  TaskId as TaskIdSchema,
} from "@yatma/core";
import * as Result from "effect/Result";

export type WriteDeps = {
  readonly deviceId: string;
  readonly lastSeenAt: string | null;
  readonly folded: FoldedEntities;
  readonly dispatch: (event: Event) => Promise<void>;
};

function userActor(deviceId: string) {
  return { kind: "user" as const, deviceId: DeviceId.make(deviceId) };
}

function stamp(deps: WriteDeps): string {
  return nextAt(deps.lastSeenAt, new Date().toISOString());
}

function prevFieldsForUpdate(current: Task, set: TaskUpdatedFields): TaskUpdatedFields | undefined {
  const prev: TaskUpdatedFields = {
    ...(set.title !== undefined ? { title: current.title } : {}),
    ...(set.notes !== undefined ? { notes: current.notes } : {}),
    ...(set.projectId !== undefined ? { projectId: current.projectId } : {}),
    ...(set.dueDate !== undefined ? { dueDate: current.dueDate } : {}),
    ...(set.status !== undefined ? { status: current.status } : {}),
    ...(set.quadrant !== undefined ? { quadrant: current.quadrant } : {}),
    ...(set.position !== undefined ? { position: current.position } : {}),
    ...(set.deleted !== undefined ? { deleted: current.deletedAt !== null } : {}),
  };
  return Object.keys(prev).length > 0 ? prev : undefined;
}

/** Create an Inbox todo at the bottom of the Now list. */
export async function createTask(
  deps: WriteDeps,
  input: { readonly title: string; readonly projectId?: string | null },
): Promise<TaskId> {
  const actor = userActor(deps.deviceId);
  const planned = planCreate(
    [...deps.folded.tasks.values()],
    {
      title: input.title,
      projectId:
        input.projectId === undefined || input.projectId === null
          ? (input.projectId ?? null)
          : ProjectIdSchema.make(input.projectId),
    },
    actor,
  );
  if (Result.isFailure(planned)) {
    throw new Error("createTask failed: agent reason required");
  }

  const taskId = TaskIdSchema.make(generateShortId("t_"));
  const at = stamp(deps);
  const event: Event = {
    v: 1,
    id: generateEventId(),
    at,
    by: actor,
    type: "task.created",
    taskId,
    projectId: planned.success.projectId,
    title: planned.success.title,
    notes: planned.success.notes,
    status: planned.success.status,
    quadrant: planned.success.quadrant,
    position: planned.success.position,
    ...(planned.success.reason ? { reason: planned.success.reason } : {}),
  };
  await deps.dispatch(event);
  return taskId;
}

/** Apply a task update planned by core rules (noop writes nothing). */
export async function updateTask(
  deps: WriteDeps,
  input: TaskUpdateInput,
): Promise<"updated" | "noop"> {
  const actor = userActor(deps.deviceId);
  const planned = planUpdate([...deps.folded.tasks.values()], input, actor);
  if (Result.isFailure(planned)) {
    throw new Error(
      planned.failure._tag === "TaskNotFound"
        ? `Task not found: ${planned.failure.taskId}`
        : "updateTask failed: agent reason required",
    );
  }
  if (planned.success.kind === "noop") return "noop";

  const current = deps.folded.tasks.get(input.taskId);
  const prev = current ? prevFieldsForUpdate(current, planned.success.set) : undefined;
  const at = stamp(deps);
  const event: Event = {
    v: 1,
    id: generateEventId(),
    at,
    by: actor,
    type: "task.updated",
    taskId: input.taskId,
    set: planned.success.set,
    ...(prev ? { prev } : {}),
    ...(planned.success.reason ? { reason: planned.success.reason } : {}),
  };
  await deps.dispatch(event);
  return "updated";
}

/** Create a project. */
export async function createProject(
  deps: WriteDeps,
  input: { readonly title: string; readonly color?: string | null },
): Promise<ProjectId> {
  const actor = userActor(deps.deviceId);
  const planned = planProjectCreate(
    [...deps.folded.projects.values()],
    { title: input.title, color: input.color ?? null },
    actor,
  );
  if (Result.isFailure(planned)) {
    throw new Error("createProject failed: agent reason required");
  }

  const projectId = ProjectIdSchema.make(generateShortId("p_"));
  const at = stamp(deps);
  const event: Event = {
    v: 1,
    id: generateEventId(),
    at,
    by: actor,
    type: "project.created",
    projectId,
    title: planned.success.title,
    color: planned.success.color,
    ...(planned.success.reason ? { reason: planned.success.reason } : {}),
  };
  await deps.dispatch(event);
  return projectId;
}
