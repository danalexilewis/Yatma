import {
  BatchId,
  PERSONAL_THREAD_ID,
  TaskId,
  formatRef,
  generateEventId,
  generateShortId,
  selectThreadTasks,
  reviewItemId,
  type BatchCommand,
  type FoldedEntities,
  type ProjectId,
} from "@yatma/core";

export type ThreadCaptureStore = {
  readonly state: { readonly folded: FoldedEntities };
  readonly executeLocalCommands: (
    commands: readonly BatchCommand[],
    context?: { readonly batchId?: BatchId },
  ) => Promise<unknown>;
};
export type ThreadCaptureIdentity = {
  readonly taskId: TaskId;
  readonly messageId: string;
  readonly batchId: BatchId;
};

/** Keep this identity for retries so task creation and its receipt stay one submission. */
export function createThreadCaptureIdentity(): ThreadCaptureIdentity {
  const submission = generateEventId();
  return {
    taskId: TaskId.make(generateShortId("t_")),
    messageId: `capture_${submission}`,
    batchId: BatchId.make(`capture:${submission}`),
  };
}

function ensureThread(store: ThreadCaptureStore): BatchCommand[] {
  return store.state.folded.chats.has(PERSONAL_THREAD_ID)
    ? []
    : [
        {
          type: "chat.create",
          chatId: PERSONAL_THREAD_ID,
          input: { projectId: null, title: "My thread" },
        },
      ];
}

/** Atomically commits a task and a durable system-reference receipt without network work. */
export async function captureThreadTask(
  store: ThreadCaptureStore,
  input: { readonly title: string; readonly projectId: ProjectId | null },
  identity: ThreadCaptureIdentity,
) {
  if (
    store.state.folded.tasks.has(identity.taskId) &&
    store.state.folded.chats
      .get(PERSONAL_THREAD_ID)
      ?.messages.some((message) => message.id === identity.messageId)
  )
    return identity;
  await store.executeLocalCommands(
    [
      ...ensureThread(store),
      { type: "task.create", taskId: identity.taskId, input },
      {
        type: "review.receive",
        input: {
          id: reviewItemId("capture", identity.taskId),
          taskId: identity.taskId,
          source: "capture",
          sourceId: identity.taskId,
          sourceRevision: "0",
          title: input.title,
          sourceUrl: null,
          receivedAt: new Date().toISOString(),
        },
      },
      {
        type: "chat.message",
        chatId: PERSONAL_THREAD_ID,
        messageId: identity.messageId,
        role: "system",
        text: `Added to your tasks:\n${formatRef("task", identity.taskId, input.title)}`,
      },
    ],
    { batchId: identity.batchId },
  );
  return identity;
}

/** Publishes every open backlog task in one stable message; individual refs remain virtualized and live. */
export async function showThreadTasks(
  store: ThreadCaptureStore,
  messageId = `tasks_${generateEventId()}`,
) {
  const tasks = selectThreadTasks(store.state.folded);
  const included = tasks;
  const remaining = 0;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const todo = tasks.length - inProgress;
  const text = included.length
    ? [
        `Your open backlog: ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} (${todo} to do, ${inProgress} in progress).`,
        ...included.map((task) => formatRef("task", task.id, task.title)),
      ].join("\n")
    : "Your open backlog is empty. Plan your next steps here, or add a task with New task.";
  await store.executeLocalCommands(
    [
      ...ensureThread(store),
      { type: "chat.message", chatId: PERSONAL_THREAD_ID, messageId, role: "system", text },
    ],
    { batchId: BatchId.make(`show-tasks:${messageId}`) },
  );
  return { messageId, included: included.length, remaining };
}
