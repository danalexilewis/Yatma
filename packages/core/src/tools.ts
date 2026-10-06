// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { BatchId, ChatId, PageId, ProjectId, TaskId } from "./ids.ts";
import { Event } from "./events.ts";
import {
  Page,
  PageBody,
  PageKind,
  Placement,
  Quadrant,
  Reason,
  Task,
  TaskStatus,
  Title,
} from "./schemas.ts";

export class ToolFailure extends Schema.TaggedError<ToolFailure>()("ToolFailure", {
  message: Schema.String,
}) {}

const shared = {
  failure: ToolFailure,
  failureMode: "return" as const,
};

export const ListTasksTool = Tool.make("list_tasks", {
  ...shared,
  description:
    "List open tasks in global priority order. Filter by project, status, quadrant, or due date.",
  parameters: Schema.Struct({
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    status: Schema.optional(TaskStatus),
    quadrant: Schema.optional(Schema.NullOr(Quadrant)),
    includeRecentDone: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  }),
  success: Schema.Struct({
    tasks: Schema.Array(Task),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const SearchTool = Tool.make("search", {
  ...shared,
  description:
    "Full-text search over tasks (including completed ones and reasons), pages, and chat summaries.",
  parameters: Schema.Struct({
    query: Schema.String.check(Schema.isNonEmpty()),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  }),
  success: Schema.Struct({
    hits: Schema.Array(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal("task"),
          id: TaskId,
          title: Title,
          snippet: Schema.String,
        }),
        Schema.Struct({
          kind: Schema.Literal("page"),
          id: PageId,
          title: Title,
          snippet: Schema.String,
        }),
        Schema.Struct({
          kind: Schema.Literal("chat"),
          id: ChatId,
          title: Schema.NullOr(Title),
          snippet: Schema.String,
        }),
      ]),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const ReadTool = Tool.make("read", {
  ...shared,
  description: "Read a task with recent history, a page, or a chat summary.",
  parameters: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("task"), taskId: TaskId }),
    Schema.Struct({ kind: Schema.Literal("page"), pageId: PageId }),
    Schema.Struct({ kind: Schema.Literal("chat"), chatId: ChatId }),
  ]),
  success: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("task"),
      task: Task,
      history: Schema.Array(Event),
    }),
    Schema.Struct({
      kind: Schema.Literal("page"),
      page: Page,
    }),
    Schema.Struct({
      kind: Schema.Literal("chat"),
      chatId: ChatId,
      title: Schema.NullOr(Title),
      summary: Schema.NullOr(Schema.String),
    }),
  ]),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const ApplyChangeOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create_task"),
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    title: Title,
    notes: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("update_task"),
    taskId: TaskId,
    title: Schema.optional(Title),
    notes: Schema.optional(Schema.String),
    status: Schema.optional(TaskStatus),
    quadrant: Schema.optional(Schema.NullOr(Quadrant)),
    placement: Schema.optional(Placement),
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    deleted: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    op: Schema.Literal("start_task"),
    taskId: TaskId,
  }),
  Schema.Struct({
    op: Schema.Literal("complete_task"),
    taskId: TaskId,
  }),
  Schema.Struct({
    op: Schema.Literal("create_project"),
    title: Title,
    color: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    op: Schema.Literal("update_project"),
    projectId: ProjectId,
    title: Schema.optional(Title),
    color: Schema.optional(Schema.NullOr(Schema.String)),
    archived: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    op: Schema.Literal("undo_batch"),
    batchId: BatchId,
  }),
]);
export type ApplyChangeOp = typeof ApplyChangeOp.Type;

export const ApplyChangesTool = Tool.make("apply_changes", {
  ...shared,
  description:
    "Apply one batch of project and task operations. Core rules validate every op before any write. Agents must pass one reason for the batch.",
  parameters: Schema.Struct({
    reason: Reason,
    ops: Schema.Array(ApplyChangeOp).check(Schema.isMinLength(1)),
  }),
  success: Schema.Struct({
    batchId: BatchId,
    events: Schema.Array(Event),
    summary: Schema.String,
  }),
}).annotate(Tool.Destructive, true);

export const WritePageTool = Tool.make("write_page", {
  ...shared,
  description: "Create or replace a page or brief. Agents must pass a reason.",
  parameters: Schema.Struct({
    pageId: Schema.optional(PageId),
    projectId: Schema.NullOr(ProjectId),
    kind: PageKind,
    title: Title,
    body: PageBody,
    pinned: Schema.optional(Schema.Boolean),
    reason: Reason,
  }),
  success: Schema.Struct({
    page: Page,
    events: Schema.Array(Event),
  }),
}).annotate(Tool.Destructive, true);

/** Schema-only toolkit stubs; handlers live in the Worker. */
export const AgentToolkit = Toolkit.make(
  ListTasksTool,
  SearchTool,
  ReadTool,
  ApplyChangesTool,
  WritePageTool,
);
