import {
  groupTasksByProject,
  type Project,
  type ProjectId,
  type Task,
  type TaskUpdateInput,
} from "@yatma/core";

export type PriorityRow =
  | { readonly kind: "task"; readonly key: string; readonly task: Task }
  | {
      readonly kind: "project";
      readonly key: string;
      readonly projectId: ProjectId | null;
      readonly title: string;
    };

/** Keep project headings in the same drag surface so tasks can cross group boundaries. */
export function priorityRows(
  tasks: readonly Task[],
  projects: ReadonlyMap<ProjectId, Project>,
  grouped: boolean,
): PriorityRow[] {
  if (!grouped) return tasks.map(taskRow);
  const groups = groupTasksByProject(tasks, projects);
  if (!groups.some((group) => group.projectId === null)) {
    groups.push({ projectId: null, title: "Unassigned", tasks: [] });
  }
  return groups.flatMap((group): PriorityRow[] => [
    {
      kind: "project",
      key: `project:${group.projectId ?? "unassigned"}`,
      projectId: group.projectId,
      title: group.title,
    },
    ...group.tasks.map(taskRow),
  ]);
}

function taskRow(task: Task): PriorityRow {
  return { kind: "task", key: task.id, task };
}

/** Translate the library's post-drop rows into one atomic priority/project command. */
export function taskUpdateFromDrop(
  data: readonly PriorityRow[],
  from: number,
  to: number,
): TaskUpdateInput | null {
  if (from === to || from < 0 || from >= data.length || to < 0 || to >= data.length) return null;
  const moved = data[to];
  if (moved?.kind !== "task") return null;
  const before = data.slice(0, to);
  const after = data.slice(to + 1);
  // A task dropped above the first heading belongs to that first group.
  const group =
    before.findLast((row) => row.kind === "project") ?? after.find((row) => row.kind === "project");
  // Grouped display order can differ from global priority. Anchor inside the
  // destination group, otherwise dropping at its top can silently do nothing.
  function belongsToDestination(row: PriorityRow) {
    return row.kind === "task" && (!group || row.task.projectId === group.projectId);
  }
  const previous = before.findLast(belongsToDestination);
  const next = after.find(belongsToDestination);
  return {
    taskId: moved.task.id,
    ...(group?.kind === "project" && group.projectId !== moved.task.projectId
      ? { projectId: group.projectId }
      : {}),
    placement:
      previous?.kind === "task"
        ? { kind: "after", taskId: previous.task.id }
        : next?.kind === "task"
          ? { kind: "before", taskId: next.task.id }
          : { kind: "bottom" },
  };
}
