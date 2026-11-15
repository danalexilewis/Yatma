import * as Schema from "effect/Schema";

import { TaskId, TrimmedNonEmptyString } from "./ids.ts";
import { CalendarDate, Reason, Title } from "./schemas.ts";
import { StackTimestamp } from "./stackSchemas.ts";

export const ReviewSource = Schema.Literals(["capture", "gmail"]);
export const ReviewDisposition = Schema.Literals([
  "pending",
  "today",
  "later",
  "waiting",
  "dismissed",
]);
export const ReviewRevision = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,39})$/));
const SourceId = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512));
const SourceUrl = Schema.NullOr(
  Schema.String.check(Schema.isMaxLength(2048), Schema.isPattern(/^https:\/\//)),
);
export const ReviewReceiveInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  taskId: Schema.NullOr(TaskId),
  source: ReviewSource,
  sourceId: SourceId,
  sourceRevision: ReviewRevision,
  title: Title,
  sourceText: Schema.optional(Schema.String.check(Schema.isMaxLength(8000))),
  sourceUrl: SourceUrl,
  receivedAt: StackTimestamp,
});
export type ReviewReceiveInput = typeof ReviewReceiveInput.Type;
export const ReviewItem = Schema.Struct({
  ...ReviewReceiveInput.fields,
  sourceText: Schema.String.check(Schema.isMaxLength(8000)),
  updatedAt: StackTimestamp,
  disposition: ReviewDisposition,
  reason: Schema.NullOr(Reason),
  revisitOn: Schema.NullOr(CalendarDate),
  seenAt: Schema.NullOr(StackTimestamp),
}).check(
  Schema.makeFilter(
    (item) =>
      item.id === reviewItemId(item.source, item.sourceId) ||
      "Review identity must match its source",
  ),
);
export type ReviewItem = typeof ReviewItem.Type;
export const ReviewUpdatedFields = Schema.Struct({
  taskId: Schema.optional(Schema.NullOr(TaskId)),
  disposition: Schema.optional(ReviewDisposition),
  reason: Schema.optional(Schema.NullOr(Reason)),
  revisitOn: Schema.optional(Schema.NullOr(CalendarDate)),
  seenAt: Schema.optional(Schema.NullOr(StackTimestamp)),
});
export type ReviewUpdatedFields = typeof ReviewUpdatedFields.Type;
export const ReviewDecideInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  disposition: ReviewDisposition,
  reason: Reason,
  revisitOn: Schema.NullOr(CalendarDate),
  expectedUpdatedAt: Schema.optional(StackTimestamp),
  expectedTaskUpdatedAt: Schema.optional(StackTimestamp),
});
export const ReviewCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("review.restore"),
    id: TrimmedNonEmptyString,
    set: ReviewUpdatedFields,
  }),
  Schema.Struct({ type: Schema.Literal("review.receive"), input: ReviewReceiveInput }),
  Schema.Struct({ type: Schema.Literal("review.decide"), input: ReviewDecideInput }),
  Schema.Struct({ type: Schema.Literal("review.seen"), id: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("review.link"),
    id: TrimmedNonEmptyString,
    taskId: TaskId,
    expectedUpdatedAt: Schema.optional(StackTimestamp),
  }),
]);
export type ReviewCommand = typeof ReviewCommand.Type;

/** Source identity includes the provider connection, so reconnects retain item identity. */
export function reviewItemId(source: typeof ReviewSource.Type, sourceId: string): string {
  return `review:${source}:${encodeURIComponent(sourceId)}`;
}

/** Pending and explicitly dated decisions resurface without changing their stored disposition. */
export function needsReview(item: ReviewItem, date: string): boolean {
  return (
    item.disposition === "pending" ||
    ((item.disposition === "later" || item.disposition === "waiting") &&
      item.revisitOn !== null &&
      item.revisitOn <= date)
  );
}
