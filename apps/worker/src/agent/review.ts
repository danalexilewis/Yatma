import {
  ReadReviewTool,
  DecideReviewTool,
  stackDayId,
  TaskId,
  generateShortId,
  type BatchCommand,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import * as EventStore from "../eventStore.ts";
import type { ToolActorContext, ToolFailure } from "./tools.ts";

export const readReview = Effect.fn("Review.read")(function* (
  input: Schema.Schema.Type<typeof ReadReviewTool.parametersSchema>,
) {
  const state = yield* EventStore.loadFolded;
  const items = [...state.reviewItems.values()]
    .filter((item) => input.disposition === undefined || item.disposition === input.disposition)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id));
  const offset = input.offset ?? 0;
  const end = offset + Math.min(input.limit ?? 10, 20);
  return {
    items: items
      .slice(offset, end)
      .map((item) => ({ ...item, sourceText: item.sourceText.slice(0, 800) })),
    linkedTasks: items.slice(offset,end).flatMap((item) => {
      const task = item.taskId ? state.tasks.get(item.taskId) : undefined;
      return task && !task.deletedAt ? [{id:task.id,title:task.title,status:task.status,updatedAt:task.updatedAt}] : [];
    }),
    total: items.length,
    nextOffset: end < items.length ? end : null,
  };
});
function failure(message: string): ToolFailure {
  return { _tag: "ToolFailure", message };
}
export const decideReview = Effect.fn("Review.decide")(function* (
  input: Schema.Schema.Type<typeof DecideReviewTool.parametersSchema>,
  ctx: ToolActorContext,
) {
  if (!ctx.mutations) return failure("Review decisions require the mutation writer");
  const state = yield* EventStore.loadFolded;
  const item = state.reviewItems.get(input.id);
  if (!item) return failure("Review item no longer exists");
  if(item.taskId && !input.expectedTaskUpdatedAt) return failure("Read the linked task and supply expectedTaskUpdatedAt before choosing");
  const commands: BatchCommand[] = [{ type: "review.decide", input }];
  if (input.disposition === "today") {
    const taskId = item.taskId ?? TaskId.make(generateShortId("t_"));
    if (!item.taskId)
      commands.push(
        {
          type: "task.create",
          taskId,
          input: {
            title: item.title,
            reason: input.reason,
            notes: item.sourceUrl ? `Source: ${item.sourceUrl}` : "",
          },
        },
        { type: "review.link", id: item.id, taskId },
      );
    commands.push(
      { type: "day.ensure", date: input.date, timezone: input.timezone },
      { type: "day.add", dayId: stackDayId(input.date, input.timezone), kind: "task", taskId },
    );
  }
  const result = yield* Effect.result(
    ctx.mutations.executeBatch({
      commands,
      actor: ctx.actor,
      batchId: ctx.batchId,
      now: ctx.nowIso,
      reason: input.reason,
    }),
  );
  if (Result.isFailure(result))
    return failure(
      result.failure._tag === "planning_failed"
        ? result.failure.failure.message
        : "Could not save the decision; retry after refreshing",
    );
  return {
    batchId: result.success.batchId,
    events: result.success.events,
    summary: "Saved your review decision",
  };
});
