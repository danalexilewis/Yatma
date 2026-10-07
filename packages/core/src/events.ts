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
  TaskUpdatedFields,
  Title,
} from "./schemas.ts";

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
  notes: Schema.optional(Notes),
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

export const Event = Schema.Union([
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
