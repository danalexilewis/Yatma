import { dedupeAndSortEvents, type FoldedEntities } from "./fold.ts";
import { ChatId as ChatIdSchema, type TaskId } from "./ids.ts";
import { isOpenTask, sortTasksByPosition } from "./rules.ts";
import type { ChatMessage, Task } from "./schemas.ts";

/** Stable per-account identity for the app's one permanent conversation. */
export const PERSONAL_THREAD_ID = ChatIdSchema.make("c_00000000");

export type ThreadEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly at: string;
      readonly message: ChatMessage;
    }
  | {
      readonly kind: "completed";
      readonly id: string;
      readonly at: string;
      readonly taskId: TaskId;
      readonly title: string;
    };

/** Current tasks in the permanent thread, highest priority first. */
export function selectThreadTasks(state: FoldedEntities): Task[] {
  return sortTasksByPosition([...state.tasks.values()]).filter((task) => isOpenTask(task));
}

/** Replay completion transitions, preserving their original titles and dates after reopen or edits. */
export function selectThreadHistory(state: FoldedEntities): ThreadEntry[] {
  const tasks = new Map<
    TaskId,
    { title: string; status: Task["status"]; projectId: Task["projectId"]; deleted: boolean }
  >();
  const entries: ThreadEntry[] = [];
  const messageIds = new Set<string>();
  for (const event of dedupeAndSortEvents(state.events)) {
    if (event.type === "chat.message") {
      // The fold keeps the latest write for a message identity.
      const message = state.chats
        .get(event.chatId)
        ?.messages.find((item) => item.id === event.messageId);
      const key = `${event.chatId}:${event.messageId}`;
      if (message && message.at === event.at && !messageIds.has(key)) {
        entries.push({ kind: "message", id: key, at: event.at, message });
        messageIds.add(key);
      }
    }
    if (event.type === "task.created") {
      tasks.set(event.taskId, {
        title: event.title,
        status: event.status,
        projectId: event.projectId,
        deleted: false,
      });
      if (event.status === "done") {
        entries.push({
          kind: "completed",
          id: event.id,
          at: event.at,
          taskId: event.taskId,
          title: event.title,
        });
      }
    }
    if (event.type === "task.updated") {
      const before = tasks.get(event.taskId);
      if (!before) continue;
      const after = {
        title: event.set.title ?? before.title,
        status: event.set.status ?? before.status,
        projectId: event.set.projectId !== undefined ? event.set.projectId : before.projectId,
        deleted: event.set.deleted ?? before.deleted,
      };
      tasks.set(event.taskId, after);
      if (before.status !== "done" && after.status === "done" && !after.deleted) {
        entries.push({
          kind: "completed",
          id: event.id,
          at: event.at,
          taskId: event.taskId,
          title: after.title,
        });
      }
    }
  }
  return entries;
}

/** Headings remain available even when their last task has been completed. */
export function selectThreadHeadings(state: FoldedEntities): string[] {
  const headings = new Set<string>();
  for (const chat of state.chats.values()) {
    for (const heading of chat.headings ?? []) headings.add(heading);
  }
  for (const task of state.tasks.values()) {
    if (task.deletedAt !== null) continue;
    for (const tag of task.tags ?? []) headings.add(tag);
  }
  return [...headings];
}

/** Groups and their members follow global priority; untagged tasks appear once in their own group. */
export function groupThreadTasks(
  tasks: readonly Task[],
  headings: readonly string[] = [],
): { readonly heading: string | null; readonly tasks: readonly Task[] }[] {
  const groups = new Map<string | null, Task[]>();
  for (const task of sortTasksByPosition(tasks)) {
    for (const tag of task.tags?.length ? new Set(task.tags) : [null]) {
      const group = groups.get(tag) ?? [];
      group.push(task);
      groups.set(tag, group);
    }
  }
  for (const heading of headings) if (!groups.has(heading)) groups.set(heading, []);
  return [...groups].map(([heading, members]) => ({ heading, tasks: members }));
}
