import type { Task, TaskId, TaskStatus, TaskUpdateInput } from "@yatma/core";

export type TaskInteractionState = {
  readonly pending: boolean;
  readonly error: string | null;
  readonly code?: string;
};
export type TaskInteractionOutcome = "updated" | "noop" | "busy" | "unavailable";
export type TaskInteractions = ReturnType<typeof createTaskInteractions>;
const IDLE: TaskInteractionState = { pending: false, error: null };

/** Coordinates committed status writes across every occurrence in one account session. */
export function createTaskInteractions(deps: {
  readonly readTask: (taskId: TaskId) => Task | undefined;
  readonly updateTask: (input: TaskUpdateInput) => Promise<"updated" | "noop">;
  readonly getGeneration: () => number;
}) {
  const states = new Map<TaskId, TaskInteractionState>();
  const listeners = new Set<() => void>();
  let generation = deps.getGeneration();

  function notify() {
    for (const listener of listeners) listener();
  }
  function reset() {
    generation = deps.getGeneration();
    states.clear();
    notify();
  }
  function getSnapshot(taskId: TaskId): TaskInteractionState {
    return generation === deps.getGeneration() ? (states.get(taskId) ?? IDLE) : IDLE;
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  async function setStatus(taskId: TaskId, status: TaskStatus): Promise<TaskInteractionOutcome> {
    if (generation !== deps.getGeneration()) reset();
    if (getSnapshot(taskId).pending) return "busy";
    const task = deps.readTask(taskId);
    if (!task || task.deletedAt !== null) return "unavailable";
    if (task.status === status) return "noop";
    const startedGeneration = generation;
    states.set(taskId, { pending: true, error: null });
    notify();
    try {
      return await deps.updateTask({ taskId, status });
    } catch (cause) {
      if (startedGeneration === deps.getGeneration()) {
        states.set(taskId, {
          pending: false,
          error: cause instanceof Error ? cause.message : "Could not save the task. Try again.",
          ...(cause instanceof Error && "code" in cause && typeof cause.code === "string"
            ? { code: cause.code }
            : {}),
        });
      }
      throw cause;
    } finally {
      if (startedGeneration === deps.getGeneration()) {
        const current = states.get(taskId);
        if (current?.pending) states.delete(taskId);
        notify();
      }
    }
  }
  return { subscribe, getSnapshot, setStatus, reset };
}
