import { dedupeAndSortEvents, type FoldedEntities } from "./fold.ts";
import { ChatId as ChatIdSchema, type TaskId, type ChatId } from "./ids.ts";
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

export type ThreadMessage = {
  readonly chatId: ChatId;
  readonly message: ChatMessage;
};
export type ThreadMessageCursor = {
  readonly at: string;
  readonly chatId: string;
  readonly messageId: string;
};
export type ThreadMessageWindow = {
  readonly messages: readonly ThreadMessage[];
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
};

export const THREAD_PAGE_SIZE = 50;
export const THREAD_MAX_MESSAGES = 150;

/** Durable assistant identity shared with the turn writer and transient reply renderer. */
export function assistantMessageId(turnId: string): string {
  return `msg_${turnId}_assistant`;
}

/** Encodes tuple identities without delimiter collisions. */
export function threadMessageKey(entry: ThreadMessage): string {
  return JSON.stringify([entry.chatId, entry.message.id]);
}

export function threadMessageCursor(entry: ThreadMessage): ThreadMessageCursor {
  return { at: entry.message.at, chatId: entry.chatId, messageId: entry.message.id };
}

/** All conversation messages, including legacy chats, without synthetic completion notices. */
export function selectThreadMessages(state: Pick<FoldedEntities, "chats">): ThreadMessage[] {
  return reconcileThreadMessages(
    [...state.chats.values()].flatMap((chat) =>
      chat.messages.map((message) => ({ chatId: chat.id, message })),
    ),
  );
}

/** One lexicographic comparator serves both paging directions and equal timestamps. */
export function compareThreadMessageCursors(
  left: ThreadMessageCursor,
  right: ThreadMessageCursor,
): number {
  for (const field of ["at", "chatId", "messageId"] as const) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}

/** Pages the hydrated collection while retaining at most 150 messages and the visible anchor. */
export function pageThreadMessages(
  all: readonly ThreadMessage[],
  retained: readonly ThreadMessage[],
  direction: "latest" | "older" | "newer",
  anchorKey?: string,
): ThreadMessageWindow {
  let start = Math.max(0, all.length - THREAD_PAGE_SIZE);
  let end = all.length;
  if (direction !== "latest" && retained.length) {
    const first = all.findIndex(
      (message) => threadMessageKey(message) === threadMessageKey(retained[0]!),
    );
    const last = all.findIndex(
      (message) => threadMessageKey(message) === threadMessageKey(retained.at(-1)!),
    );
    if (first >= 0 && last >= 0) {
      start = direction === "older" ? Math.max(0, first - THREAD_PAGE_SIZE) : first;
      end = direction === "newer" ? Math.min(all.length, last + 1 + THREAD_PAGE_SIZE) : last + 1;
    }
  }
  if (end - start > THREAD_MAX_MESSAGES) {
    const anchor = anchorKey
      ? all.findIndex((message) => threadMessageKey(message) === anchorKey)
      : -1;
    if (direction === "older") {
      if (anchor >= start + THREAD_MAX_MESSAGES && anchor < end)
        start = anchor - THREAD_MAX_MESSAGES + 1;
      end = start + THREAD_MAX_MESSAGES;
    } else {
      if (anchor >= start && anchor < end - THREAD_MAX_MESSAGES) end = anchor + THREAD_MAX_MESSAGES;
      start = end - THREAD_MAX_MESSAGES;
    }
  }
  return { messages: all.slice(start, end), hasOlder: start > 0, hasNewer: end < all.length };
}

/** Replaces only the matching transient identity; equal text is never a message identity. */
export function reconcileThreadMessages(
  messages: readonly ThreadMessage[],
  transient?: ThreadMessage,
): ThreadMessage[] {
  const byIdentity = new Map(messages.map((message) => [threadMessageKey(message), message]));
  if (transient && !byIdentity.has(threadMessageKey(transient)))
    byIdentity.set(threadMessageKey(transient), transient);
  return [...byIdentity.values()].toSorted((left, right) =>
    compareThreadMessageCursors(threadMessageCursor(left), threadMessageCursor(right)),
  );
}
