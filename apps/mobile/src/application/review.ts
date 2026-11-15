import {
  BatchId,
  PERSONAL_THREAD_ID,
  TaskId,
  formatRef,
  generateEventId,
  generateShortId,
  stackDayId,
  type BatchCommand,
  type FoldedEntities,
  type ReviewItem,
} from "@yatma/core";

import type { LocalMutationResult } from "./mutations";

export type ReviewDecisionResult = LocalMutationResult & { readonly batchId: string };

export type ReviewStore = {
  readonly state: { readonly folded: FoldedEntities };
  readonly executeLocalCommands: (
    commands: readonly BatchCommand[],
    context?: { readonly batchId?: BatchId },
  ) => Promise<LocalMutationResult>;
};

/** A review decision and its selected daily commitment share one local transaction. */
export async function decideReview(
  store: ReviewStore,
  item: ReviewItem,
  input: {
    readonly disposition: ReviewItem["disposition"];
    readonly reason: string;
    readonly revisitOn: string | null;
    readonly date: string;
    readonly timezone: string;
  },
) {
  const current = store.state.folded.reviewItems.get(item.id);
  if (!current || current.updatedAt !== item.updatedAt)
    throw new Error("This item changed. Review its latest details before deciding.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Add a short reason for this decision.");
  const commands: BatchCommand[] = [];
  let taskId = item.taskId;
  if (input.disposition === "today") {
    if (taskId) {
      const task = store.state.folded.tasks.get(taskId);
      if (!task || task.deletedAt || task.status === "done")
        throw new Error(
          "This task is no longer available for Today. Open its details to review it.",
        );
    } else {
      taskId = TaskId.make(generateShortId("t_"));
      commands.push({
        type: "task.create",
        taskId,
        input: { title: item.title, notes: item.sourceUrl ? `Source: ${item.sourceUrl}` : "" },
      });
    }
  }
  commands.push({
    type: "review.decide",
    input: {
      id: item.id,
      disposition: input.disposition,
      reason,
      revisitOn: input.revisitOn,
      expectedUpdatedAt: item.updatedAt,
      ...(item.taskId && store.state.folded.tasks.get(item.taskId)
        ? { expectedTaskUpdatedAt: store.state.folded.tasks.get(item.taskId)!.updatedAt }
        : {}),
    },
  });
  // Check the linked task's version before day.add stages its scheduling update.
  if (input.disposition === "today" && taskId) {
    commands.push(
      { type: "day.ensure", date: input.date, timezone: input.timezone },
      { type: "day.add", dayId: stackDayId(input.date, input.timezone), kind: "task", taskId },
    );
  }
  if (taskId && !item.taskId) commands.push({ type: "review.link", id: item.id, taskId });
  if (!store.state.folded.chats.has(PERSONAL_THREAD_ID))
    commands.push({
      type: "chat.create",
      chatId: PERSONAL_THREAD_ID,
      input: { projectId: null, title: "My thread" },
    });
  commands.push({
    type: "chat.message",
    chatId: PERSONAL_THREAD_ID,
    messageId: `review_${generateEventId()}`,
    role: "system",
    text: `${input.disposition === "today" ? `Selected for ${input.date}` : `Review decision: ${input.disposition}`} — ${taskId ? formatRef("task", taskId, item.title) : item.title}\n${reason}${input.revisitOn ? `\nRevisit ${input.revisitOn}` : ""}`,
  });
  const batchId = BatchId.make(`review:${generateEventId()}`);
  const result = await store.executeLocalCommands(commands, { batchId });
  return { ...result, batchId };
}
