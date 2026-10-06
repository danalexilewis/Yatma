import type { Chat, FoldedEntities, Page, Project, Task } from "@yatma/core";
import {
  isVisibleInSnapshot,
  selectDoingSummary,
  selectNowList,
  selectTriageBuckets,
} from "@yatma/core";

const RECENT_MS = 24 * 60 * 60 * 1000;

/** Open tasks in global priority order (Now list). */
export function selectNowTasks(state: FoldedEntities): Task[] {
  return selectNowList([...state.tasks.values()]);
}

/** Tasks currently marked in progress. */
export function selectDoingTasks(state: FoldedEntities): Task[] {
  return selectDoingSummary([...state.tasks.values()], state.projects).byProject.flatMap(
    (group) => group.tasks,
  );
}

/** Inbox = open tasks with no quadrant. */
export function selectInboxTasks(state: FoldedEntities): Task[] {
  return [...selectTriageBuckets([...state.tasks.values()]).inbox];
}

/** Open tasks in a given Eisenhower quadrant. */
export function selectQuadrantTasks(
  state: FoldedEntities,
  quadrant: "do" | "schedule" | "delegate" | "eliminate",
): Task[] {
  return [...selectTriageBuckets([...state.tasks.values()])[quadrant]];
}

/** Active (non-archived) projects. */
export function selectActiveProjects(state: FoldedEntities): Project[] {
  return [...state.projects.values()]
    .filter((project) => project.archivedAt === null)
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

/** Open tasks for a project. */
export function selectProjectTasks(state: FoldedEntities, projectId: string): Task[] {
  return selectNowTasks(state).filter((task) => task.projectId === projectId);
}

/** Visible chats newest-first. */
export function selectChats(state: FoldedEntities): Chat[] {
  return [...state.chats.values()].toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Non-deleted pages, optionally scoped to a project. */
export function selectPages(state: FoldedEntities, projectId?: string | null): Page[] {
  return [...state.pages.values()]
    .filter((page) => page.deletedAt === null)
    .filter((page) => (projectId === undefined ? true : page.projectId === projectId))
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Snapshot used by Now: open + recently completed/deleted. */
export function selectVisibleTasks(state: FoldedEntities, nowMs = Date.now()): Task[] {
  return [...state.tasks.values()]
    .filter((task) => isVisibleInSnapshot(task, nowMs, RECENT_MS))
    .toSorted((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return a.id < b.id ? -1 : 1;
    });
}

export function selectTask(state: FoldedEntities, taskId: string): Task | undefined {
  return state.tasks.get(taskId as Task["id"]);
}

export function selectProject(state: FoldedEntities, projectId: string): Project | undefined {
  return state.projects.get(projectId as Project["id"]);
}

export function selectPage(state: FoldedEntities, pageId: string): Page | undefined {
  return state.pages.get(pageId as Page["id"]);
}

export function selectChat(state: FoldedEntities, chatId: string): Chat | undefined {
  return state.chats.get(chatId as Chat["id"]);
}

/** History events for a task, newest first. */
export function selectTaskHistory(state: FoldedEntities, taskId: string) {
  return state.events
    .filter((event) => {
      if (event.type !== "task.created" && event.type !== "task.updated") return false;
      return event.taskId === taskId;
    })
    .toReversed();
}
