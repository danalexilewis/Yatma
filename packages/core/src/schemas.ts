// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Schema from "effect/Schema";

import {
  ChatId,
  DeviceId,
  PageId,
  ProjectId,
  TaskId,
  TrimmedNonEmptyString,
} from "./ids.ts";

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

export const TaskStatus = Schema.Literals(["todo", "in_progress", "done"]);
export type TaskStatus = typeof TaskStatus.Type;

export const Quadrant = Schema.Literals(["do", "schedule", "delegate", "eliminate"]);
export type Quadrant = typeof Quadrant.Type;

export const Title = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export type Title = typeof Title.Type;

export const Notes = Schema.String.check(Schema.isMaxLength(2000));
export type Notes = typeof Notes.Type;

export const Reason = TrimmedNonEmptyString.check(Schema.isMaxLength(280));
export type Reason = typeof Reason.Type;

/** Calendar date without a time or timezone. */
export const DueDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type DueDate = typeof DueDate.Type;

export const Position = TrimmedNonEmptyString;
export type Position = typeof Position.Type;

export const PageKind = Schema.Literals(["brief", "page"]);
export type PageKind = typeof PageKind.Type;

export const PageBody = Schema.String.check(Schema.isMaxLength(20_000));
export type PageBody = typeof PageBody.Type;

export const Actor = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("user"),
    deviceId: DeviceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("agent"),
    chatId: ChatId,
    model: Schema.String,
  }),
]);
export type Actor = typeof Actor.Type;

export const Placement = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("top") }),
  Schema.Struct({ kind: Schema.Literal("bottom") }),
  Schema.Struct({
    kind: Schema.Literal("before"),
    taskId: TaskId,
  }),
  Schema.Struct({
    kind: Schema.Literal("after"),
    taskId: TaskId,
  }),
]);
export type Placement = typeof Placement.Type;

export const Task = Schema.Struct({
  id: TaskId,
  projectId: Schema.NullOr(ProjectId),
  title: Title,
  notes: Notes,
  dueDate: Schema.NullOr(DueDate),
  status: TaskStatus,
  /** Null means Inbox (not yet triaged into a quadrant). */
  quadrant: Schema.NullOr(Quadrant),
  /** Fractional order key; global across projects. */
  position: Position,
  createdAt: IsoDateTime,
  createdBy: Actor,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
  lastReason: Schema.NullOr(Reason),
});
export type Task = typeof Task.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  title: Title,
  color: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Project = typeof Project.Type;

export const Page = Schema.Struct({
  id: PageId,
  projectId: Schema.NullOr(ProjectId),
  kind: PageKind,
  title: Title,
  body: PageBody,
  pinned: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
  lastReason: Schema.NullOr(Reason),
});
export type Page = typeof Page.Type;

export const ChatMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type ChatMessageRole = typeof ChatMessageRole.Type;

export const ChatMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: ChatMessageRole,
  text: Schema.String,
  at: IsoDateTime,
});
export type ChatMessage = typeof ChatMessage.Type;

export const Chat = Schema.Struct({
  id: ChatId,
  projectId: Schema.NullOr(ProjectId),
  title: Schema.NullOr(Title),
  summary: Schema.NullOr(Schema.String),
  messages: Schema.Array(ChatMessage),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Chat = typeof Chat.Type;

export const TaskCreateInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  title: Title,
  notes: Schema.optional(Notes),
  dueDate: Schema.optional(Schema.NullOr(DueDate)),
  reason: Schema.optional(Reason),
});
export type TaskCreateInput = typeof TaskCreateInput.Type;

export const TaskUpdateInput = Schema.Struct({
  taskId: TaskId,
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  title: Schema.optional(Title),
  notes: Schema.optional(Notes),
  dueDate: Schema.optional(Schema.NullOr(DueDate)),
  status: Schema.optional(TaskStatus),
  quadrant: Schema.optional(Schema.NullOr(Quadrant)),
  placement: Schema.optional(Placement),
  /** true deletes; false restores. */
  deleted: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Reason),
});
export type TaskUpdateInput = typeof TaskUpdateInput.Type;

export const ProjectCreateInput = Schema.Struct({
  title: Title,
  color: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.optional(Reason),
});
export type ProjectCreateInput = typeof ProjectCreateInput.Type;

export const ProjectUpdateInput = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(Title),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Reason),
});
export type ProjectUpdateInput = typeof ProjectUpdateInput.Type;

export const TaskUpdatedFields = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  title: Schema.optional(Title),
  notes: Schema.optional(Notes),
  dueDate: Schema.optional(Schema.NullOr(DueDate)),
  status: Schema.optional(TaskStatus),
  quadrant: Schema.optional(Schema.NullOr(Quadrant)),
  position: Schema.optional(Position),
  deleted: Schema.optional(Schema.Boolean),
});
export type TaskUpdatedFields = typeof TaskUpdatedFields.Type;

export const ProjectUpdatedFields = Schema.Struct({
  title: Schema.optional(Title),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.Boolean),
});
export type ProjectUpdatedFields = typeof ProjectUpdatedFields.Type;

export const PageUpdatedFields = Schema.Struct({
  title: Schema.optional(Title),
  body: Schema.optional(PageBody),
  pinned: Schema.optional(Schema.Boolean),
  deleted: Schema.optional(Schema.Boolean),
});
export type PageUpdatedFields = typeof PageUpdatedFields.Type;

export const ChatUpdatedFields = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Title)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ChatUpdatedFields = typeof ChatUpdatedFields.Type;
