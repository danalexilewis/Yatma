import type { BatchCommand } from "./batch.ts";
import type { FoldedEntities } from "./fold.ts";
import { ProjectId, CROCKFORD_BASE32 } from "./ids.ts";
import { addCalendarDays } from "./dates.ts";
import { isOpenTask, sortTasksByPosition } from "./rules.ts";
import type { Project, Task } from "./schemas.ts";

/** Project sections retain the single global priority order and include only outstanding work. */
export function groupTasksByProject(
  tasks: readonly Task[],
  projects: ReadonlyMap<ProjectId, Project>,
) {
  const groups = new Map<
    ProjectId | null,
    { projectId: ProjectId | null; title: string; tasks: Task[] }
  >();
  for (const task of sortTasksByPosition(tasks).filter(isOpenTask)) {
    const group = groups.get(task.projectId) ?? {
      projectId: task.projectId,
      title: task.projectId
        ? (projects.get(task.projectId)?.title ?? "Unknown project")
        : "Unassigned",
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.projectId, group);
  }
  return [...groups.values()];
}

/** Factual health indicators use a caller-supplied local calendar day. */
export function projectHealth(project: Project, tasks: readonly Task[], today: string) {
  const members = tasks.filter((task) => task.projectId === project.id && task.deletedAt === null);
  const open = sortTasksByPosition(members.filter(isOpenTask));
  const completed = members.filter((task) => task.status === "done").length;
  const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < today);
  const dueSoon = open.filter(
    (task) =>
      task.dueDate !== null && task.dueDate >= today && task.dueDate <= addCalendarDays(today, 7),
  );
  const undated = open.filter((task) => task.dueDate === null);
  const pastTarget = open.length > 0 && !!project.targetDate && project.targetDate < today;
  const label =
    overdue.length || pastTarget
      ? "Needs attention"
      : !members.length
        ? "No tasks yet"
        : !open.length
          ? "Complete"
          : dueSoon.length
            ? "Due soon"
            : undated.length === open.length
              ? "Needs dates"
              : "On track";
  return {
    label,
    open,
    completed,
    total: members.length,
    overdue,
    dueSoon,
    undated,
    pastTarget,
    progress: members.length ? completed / members.length : 0,
  };
}

/** Stable IDs let two offline clients migrate the same heading into one project. */
export function legacyHeadingProjectId(title: string): ProjectId {
  const name = `legacy-project:${title.trim().normalize("NFKC").toLowerCase()}`;
  let hash = 0xcbf29ce484222325n;
  for (const char of name)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 0x100000001b3n);
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += CROCKFORD_BASE32[Number(hash & 31n)];
    hash >>= 5n;
  }
  return ProjectId.make(`p_${suffix}`);
}

/** Convert legacy grouping atomically; ambiguous tasks remain unassigned and existing projects win. */
export function planProjectConsolidation(
  state: FoldedEntities,
  allocateId: (title: string) => ProjectId,
): BatchCommand[] {
  const commands: BatchCommand[] = [];
  const projects = new Map(state.projects);
  const byName = new Map<string, ProjectId>();
  function key(title: string) {
    return title.trim().normalize("NFKC").toLowerCase();
  }
  for (const project of projects.values())
    if (project.archivedAt === null && !byName.has(key(project.title)))
      byName.set(key(project.title), project.id);
  const headings = new Set<string>();
  for (const chat of state.chats.values())
    for (const title of chat.headings ?? []) if (title.trim()) headings.add(title.trim());
  for (const task of state.tasks.values())
    for (const title of task.tags ?? []) if (title.trim()) headings.add(title.trim());
  for (const title of headings) {
    if (byName.has(key(title))) continue;
    let id = allocateId(title);
    let collision = 0;
    while (projects.has(id)) id = allocateId(`${title}:${++collision}`);
    byName.set(key(title), id);
    projects.set(id, { id, title, color: null, archivedAt: null, createdAt: "", updatedAt: "" });
    commands.push({ type: "project.create", projectId: id, input: { title } });
  }
  for (const task of state.tasks.values()) {
    if (!task.tags?.length) continue;
    const names = [...new Set(task.tags.map(key).filter(Boolean))];
    const projectId = task.projectId ?? (names.length === 1 ? byName.get(names[0]!) : null);
    commands.push({
      type: "task.update",
      input: {
        taskId: task.id,
        tags: [],
        ...(projectId && task.projectId === null ? { projectId } : {}),
      },
    });
  }
  for (const chat of state.chats.values())
    if (chat.headings?.length)
      commands.push({ type: "chat.update", input: { chatId: chat.id, headings: [] } });
  return commands;
}
