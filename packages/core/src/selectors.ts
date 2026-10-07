// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { ProjectId } from "./ids.ts";
import type { Project, Quadrant, Task } from "./schemas.ts";
import { isOpenTask, sortTasksByPosition } from "./rules.ts";

export type TriageBucket = Quadrant | "inbox";

export type TriageBuckets = {
  readonly inbox: readonly Task[];
  readonly do: readonly Task[];
  readonly schedule: readonly Task[];
  readonly delegate: readonly Task[];
  readonly eliminate: readonly Task[];
};

export type DoingProjectGroup = {
  readonly projectId: ProjectId | null;
  readonly projectTitle: string;
  readonly tasks: readonly Task[];
};

export type DoingSummary = {
  readonly count: number;
  readonly projectCount: number;
  readonly byProject: readonly DoingProjectGroup[];
};

function bucketOf(task: Task): TriageBucket {
  return task.quadrant ?? "inbox";
}

/** Global priority list: open tasks sorted by position. */
export function selectNowList(tasks: readonly Task[]): Task[] {
  return sortTasksByPosition(tasks).filter(isOpenTask);
}

/** Open To do tasks grouped into Inbox + Eisenhower quadrants. */
export function selectTriageBuckets(tasks: readonly Task[]): TriageBuckets {
  const buckets: {
    inbox: Task[];
    do: Task[];
    schedule: Task[];
    delegate: Task[];
    eliminate: Task[];
  } = {
    inbox: [],
    do: [],
    schedule: [],
    delegate: [],
    eliminate: [],
  };

  for (const task of sortTasksByPosition(tasks)) {
    if (!isOpenTask(task) || task.status !== "todo") continue;
    buckets[bucketOf(task)].push(task);
  }

  return buckets;
}

/** In-progress tasks, with a chip-friendly count across projects. */
export function selectDoingSummary(
  tasks: readonly Task[],
  projects: ReadonlyMap<ProjectId, Project>,
): DoingSummary {
  const doing = sortTasksByPosition(tasks).filter(
    (task) => task.deletedAt === null && task.status === "in_progress",
  );

  const groups = new Map<string, DoingProjectGroup>();
  for (const task of doing) {
    const key = task.projectId ?? "";
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, tasks: [...existing.tasks, task] });
      continue;
    }
    const projectTitle =
      task.projectId === null
        ? "Inbox"
        : (projects.get(task.projectId)?.title ?? "Unknown project");
    groups.set(key, {
      projectId: task.projectId,
      projectTitle,
      tasks: [task],
    });
  }

  return {
    count: doing.length,
    projectCount: groups.size,
    byProject: [...groups.values()],
  };
}
