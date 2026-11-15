import * as Result from "effect/Result";

import type { BatchSnapshot, EventDraft, PlanBatchContext } from "./batch.ts";
import type { Event } from "./events.ts";
import type { ReviewCommand, ReviewItem, ReviewUpdatedFields } from "./review.ts";
import { reviewItemId } from "./review.ts";

export type ReviewFailure = {
  readonly code: "invalid_command" | "missing_reference" | "entity_conflict" | "reason_required";
  readonly message: string;
  readonly entityId?: string;
};

/** Stage intake and explicit decisions without changing task status or daily selection. */
export function planReviewCommand(
  snapshot: BatchSnapshot,
  command: ReviewCommand,
  context: PlanBatchContext,
): Result.Result<readonly EventDraft[], ReviewFailure> {
  if (!context.now || !Number.isFinite(Date.parse(context.now)))
    return Result.fail({
      code: "invalid_command",
      message: "Review commands require a valid supplied clock",
    });
  const now = new Date(context.now).toISOString();
  const id = "input" in command ? command.input.id : command.id;
  const current = snapshot.reviewItems?.get(id);
  function invalid(message: string, code: ReviewFailure["code"] = "invalid_command") {
    return Result.fail({ code, message, entityId: id });
  }
  function emit(payload: object): Result.Result<readonly EventDraft[], ReviewFailure> {
    return Result.succeed([
      {
        ...payload,
        v: 1,
        by: context.actor,
        ...(context.reason ? { reason: context.reason } : {}),
        ...(context.batchId ? { batch: context.batchId } : {}),
        ...(context.undoes ? { undoes: context.undoes } : {}),
      } as EventDraft,
    ]);
  }
  if (command.type === "review.receive") {
    const input = command.input;
    if (id !== reviewItemId(input.source, input.sourceId))
      return invalid("Review identity must match its source");
    if (
      input.taskId &&
      (!snapshot.tasks.has(input.taskId) || snapshot.tasks.get(input.taskId)?.deletedAt)
    )
      return invalid("Linked task does not exist", "missing_reference");
    if (current) {
      if (current.source !== input.source || current.sourceId !== input.sourceId)
        return invalid("Review source identity cannot change", "entity_conflict");
      if (BigInt(input.sourceRevision) < BigInt(current.sourceRevision)) return Result.succeed([]);
      if (input.sourceRevision === current.sourceRevision) {
        if (
          input.title !== current.title ||
          input.sourceUrl !== current.sourceUrl ||
          (input.sourceText ?? "") !== current.sourceText
        )
          return invalid("A source revision cannot have different content", "entity_conflict");
        return Result.succeed([]);
      }
    }
    const item: ReviewItem = current
      ? {
          ...current,
          title: input.title,
          sourceText: input.sourceText ?? "",
          sourceUrl: input.sourceUrl,
          sourceRevision: input.sourceRevision,
          updatedAt: now,
          seenAt: null,
        }
      : {
          ...input,
          sourceText: input.sourceText ?? "",
          updatedAt: now,
          disposition: "pending",
          reason: null,
          revisitOn: null,
          seenAt: null,
        };
    return emit({ type: "review.received", item });
  }
  if (!current) return invalid("Review item does not exist", "missing_reference");
  const expected =
    command.type === "review.decide"
      ? command.input.expectedUpdatedAt
      : command.type === "review.link"
        ? command.expectedUpdatedAt
        : undefined;
  if (expected !== undefined && expected !== current.updatedAt)
    return invalid("Review item changed; review the current version", "entity_conflict");
  if (command.type === "review.decide" && command.input.expectedTaskUpdatedAt !== undefined) {
    const task = current.taskId === null ? undefined : snapshot.tasks.get(current.taskId);
    if (!task || task.updatedAt !== command.input.expectedTaskUpdatedAt)
      return invalid("Linked task changed; review its current details", "entity_conflict");
  }
  let set: ReviewUpdatedFields;
  if (command.type === "review.restore") {
    if (!context.undoes) return invalid("Review restore requires an Undo batch");
    set = command.set;
  } else if (command.type === "review.seen") {
    if (current.seenAt !== null) return Result.succeed([]);
    set = { seenAt: now };
  } else if (command.type === "review.link") {
    const task = snapshot.tasks.get(command.taskId);
    if (!task || task.deletedAt !== null)
      return invalid("Linked task does not exist", "missing_reference");
    if (current.taskId && current.taskId !== command.taskId)
      return invalid("Review item is already linked to another task", "entity_conflict");
    set = { taskId: command.taskId };
  } else {
    const input = command.input;
    if (!input.reason.trim()) return invalid("Explain the review decision", "reason_required");
    if (
      input.revisitOn !== null &&
      input.disposition !== "later" &&
      input.disposition !== "waiting"
    )
      return invalid("Only later or waiting decisions have a revisit date");
    set = {
      disposition: input.disposition,
      reason: input.reason.trim(),
      revisitOn: input.revisitOn,
    };
  }
  const changed: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(set))
    if (Reflect.get(current, key) !== value) {
      changed[key] = value;
      prev[key] = Reflect.get(current, key);
    }
  if (!Object.keys(changed).length) return Result.succeed([]);
  return emit({ type: "review.updated", itemId: id, set: changed, prev });
}

/** Source revisions win independently of local decision order; receipt retries are harmless. */
export function applyReviewEvent(items: Map<string, ReviewItem>, event: Event): void {
  if (event.type === "review.received") {
    const incoming = event.item;
    const current = items.get(incoming.id);
    if (!current) items.set(incoming.id, { ...incoming, updatedAt: event.at });
    else if (BigInt(incoming.sourceRevision) > BigInt(current.sourceRevision))
      items.set(current.id, {
        ...current,
        title: incoming.title,
        sourceText: incoming.sourceText,
        sourceUrl: incoming.sourceUrl,
        sourceRevision: incoming.sourceRevision,
        seenAt: null,
        updatedAt: event.at,
      });
  } else if (event.type === "review.updated") {
    const current = items.get(event.itemId);
    if (current) {
      const next = { ...current, updatedAt: event.at };
      for (const [key, value] of Object.entries(event.set))
        if (value !== undefined) Reflect.set(next, key, value);
      items.set(current.id, next);
    }
  }
}
