import { TaskId, parseRefHref, type TaskStatus } from "@yatma/core";
import { useSyncExternalStore } from "react";

import { useAppStore } from "../../state/atoms";

/** Reads live task data while pending/error state survives virtualized row unmounts. */
export function useTaskInteraction(id: string) {
  const store = useAppStore();
  const parsed = parseRefHref(`task:${id}`);
  const taskId =
    parsed.ok && parsed.ref.kind === "task" ? parsed.ref.id : TaskId.make("t_00000000");
  const coordinator = store.taskInteractions;
  const interaction = useSyncExternalStore(
    coordinator.subscribe,
    () => coordinator.getSnapshot(taskId),
    () => coordinator.getSnapshot(taskId),
  );
  const task = parsed.ok ? store.state.folded.tasks.get(taskId) : undefined;
  function setStatus(status: TaskStatus) {
    return parsed.ok
      ? coordinator.setStatus(taskId, status)
      : Promise.resolve("unavailable" as const);
  }
  return {
    task,
    availability: !task
      ? ("missing" as const)
      : task.deletedAt
        ? ("deleted" as const)
        : ("available" as const),
    ...interaction,
    setStatus,
  };
}
