// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Schema from "effect/Schema";

import {
  BatchId,
  ChatId,
  EventId,
  PageId,
  ProjectId,
  TaskId,
  TrimmedNonEmptyString,
} from "./ids.ts";
import {
  Actor,
  ChatMessageRole,
  ChatUpdatedFields,
  IsoDateTime,
  Notes,
  PageBody,
  PageKind,
  PageUpdatedFields,
  ProjectUpdatedFields,
  Quadrant,
  Reason,
  TaskStatus,
  TaskEstimateMinutes,
  TaskContext,
  TaskTags,
  TaskTodos,
  TaskPriority,
  TaskUpdatedFields,
  Title,
} from "./schemas.ts";

import {
  Day,
  DayUpdatedFields,
  DayEntry,
  DayEntryUpdatedFields,
  WorkInterval,
  WorkIntervalUpdatedFields,
  StackTemplate,
  StackPreferencesUpdatedFields,
  StackTimestamp,
} from "./stackSchemas.ts";

import { ReviewItem, ReviewUpdatedFields } from "./review.ts";

const EnvelopeFields = {
  v: Schema.Literal(1),
  id: EventId,
  at: IsoDateTime,
  by: Actor,
  reason: Schema.optional(Reason),
  batch: Schema.optional(BatchId),
  undoes: Schema.optional(BatchId),
  /** Assigned by the server on sync; absent in the phone outbox. */
  seq: Schema.optional(Schema.Number),
};

export const ProjectCreatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("project.created"),
  projectId: ProjectId,
  title: Title,
  color: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ProjectCreatedEvent = typeof ProjectCreatedEvent.Type;

export const ProjectUpdatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("project.updated"),
  projectId: ProjectId,
  set: ProjectUpdatedFields,
  /** Field values before this update, for undo. */
  prev: Schema.optional(ProjectUpdatedFields),
});
export type ProjectUpdatedEvent = typeof ProjectUpdatedEvent.Type;

export const TaskCreatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("task.created"),
  taskId: TaskId,
  projectId: Schema.NullOr(ProjectId),
  title: Title,
  tags: Schema.optional(TaskTags),
  notes: Schema.optional(Notes),
  todos: Schema.optional(TaskTodos),
  estimateMinutes: Schema.optional(TaskEstimateMinutes),
  place: Schema.optional(TaskContext),
  mentalMode: Schema.optional(TaskContext),
  priority: Schema.optional(Schema.NullOr(TaskPriority)),
  scheduledDate: Schema.optional(Schema.NullOr(Schema.String)),
  dueDate: Schema.optional(Schema.NullOr(Schema.String)),
  status: TaskStatus,
  quadrant: Schema.NullOr(Quadrant),
  position: TrimmedNonEmptyString,
});
export type TaskCreatedEvent = typeof TaskCreatedEvent.Type;

export const TaskUpdatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("task.updated"),
  taskId: TaskId,
  set: TaskUpdatedFields,
  /** Field values before this update, for undo. */
  prev: Schema.optional(TaskUpdatedFields),
});
export type TaskUpdatedEvent = typeof TaskUpdatedEvent.Type;

export const PageCreatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("page.created"),
  pageId: PageId,
  projectId: Schema.NullOr(ProjectId),
  kind: PageKind,
  title: Title,
  body: PageBody,
  pinned: Schema.optional(Schema.Boolean),
});
export type PageCreatedEvent = typeof PageCreatedEvent.Type;

export const PageUpdatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("page.updated"),
  pageId: PageId,
  set: PageUpdatedFields,
  prev: Schema.optional(PageUpdatedFields),
});
export type PageUpdatedEvent = typeof PageUpdatedEvent.Type;

export const ChatCreatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("chat.created"),
  chatId: ChatId,
  projectId: Schema.NullOr(ProjectId),
  title: Schema.optional(Schema.NullOr(Title)),
});
export type ChatCreatedEvent = typeof ChatCreatedEvent.Type;

export const ChatMessageEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("chat.message"),
  chatId: ChatId,
  messageId: TrimmedNonEmptyString,
  role: ChatMessageRole,
  text: Schema.String,
});
export type ChatMessageEvent = typeof ChatMessageEvent.Type;

export const ChatUpdatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("chat.updated"),
  chatId: ChatId,
  set: ChatUpdatedFields,
  prev: Schema.optional(ChatUpdatedFields),
});
export type ChatUpdatedEvent = typeof ChatUpdatedEvent.Type;

const StackEnvelopeFields = { ...EnvelopeFields, at: StackTimestamp };

export const DayCreatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("day.created"),
  day: Day,
});
export const DayUpdatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("day.updated"),
  dayId: TrimmedNonEmptyString,
  set: DayUpdatedFields,
  prev: Schema.optional(DayUpdatedFields),
});
export const DayEntryCreatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("dayEntry.created"),
  entry: DayEntry,
});
export const DayEntryUpdatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("dayEntry.updated"),
  entryId: TrimmedNonEmptyString,
  set: DayEntryUpdatedFields,
  prev: Schema.optional(DayEntryUpdatedFields),
});
export const WorkIntervalCreatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("workInterval.created"),
  interval: WorkInterval,
});
export const WorkIntervalUpdatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("workInterval.updated"),
  intervalId: TrimmedNonEmptyString,
  set: WorkIntervalUpdatedFields,
  prev: Schema.optional(WorkIntervalUpdatedFields),
});
export const StackTemplateSavedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("stackTemplate.saved"),
  template: StackTemplate,
  prev: Schema.optional(Schema.NullOr(StackTemplate)),
});
export const StackPreferencesUpdatedEvent = Schema.Struct({
  ...StackEnvelopeFields,
  type: Schema.Literal("stackPreferences.updated"),
  set: StackPreferencesUpdatedFields,
  prev: Schema.optional(StackPreferencesUpdatedFields),
});
export type DayCreatedEvent = typeof DayCreatedEvent.Type;
export type DayUpdatedEvent = typeof DayUpdatedEvent.Type;
export type DayEntryCreatedEvent = typeof DayEntryCreatedEvent.Type;
export type DayEntryUpdatedEvent = typeof DayEntryUpdatedEvent.Type;
export type WorkIntervalCreatedEvent = typeof WorkIntervalCreatedEvent.Type;
export type WorkIntervalUpdatedEvent = typeof WorkIntervalUpdatedEvent.Type;
export type StackTemplateSavedEvent = typeof StackTemplateSavedEvent.Type;
export type StackPreferencesUpdatedEvent = typeof StackPreferencesUpdatedEvent.Type;

export const ReviewReceivedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("review.received"),
  item: ReviewItem,
});
export const ReviewUpdatedEvent = Schema.Struct({
  ...EnvelopeFields,
  type: Schema.Literal("review.updated"),
  itemId: TrimmedNonEmptyString,
  set: ReviewUpdatedFields,
  prev: Schema.optional(ReviewUpdatedFields),
});

export const Event = Schema.Union([
  ReviewReceivedEvent,
  ReviewUpdatedEvent,
  DayCreatedEvent,
  DayUpdatedEvent,
  DayEntryCreatedEvent,
  DayEntryUpdatedEvent,
  WorkIntervalCreatedEvent,
  WorkIntervalUpdatedEvent,
  StackTemplateSavedEvent,
  StackPreferencesUpdatedEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
  PageCreatedEvent,
  PageUpdatedEvent,
  ChatCreatedEvent,
  ChatMessageEvent,
  ChatUpdatedEvent,
]);
export type Event = typeof Event.Type;

export const EventSchema = Event;
