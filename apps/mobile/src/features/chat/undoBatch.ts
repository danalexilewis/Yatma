import {
  type Event,
  type FoldedEntities,
  BatchId as BatchIdSchema,
  DeviceId,
  generateEventId,
  planUndo,
} from "@yatma/core";

/** Turn planUndo reverts into dispatchable events for the local outbox. */
export function eventsFromUndoPlan(input: {
  readonly batchId: string;
  readonly batchEvents: readonly Event[];
  readonly folded: FoldedEntities;
  readonly deviceId: string;
  readonly nowIso?: string;
}): Event[] {
  const plan = planUndo(input.batchEvents, {
    projects: input.folded.projects,
    tasks: input.folded.tasks,
    pages: input.folded.pages,
    chats: input.folded.chats,
  });
  const nowIso = input.nowIso ?? new Date().toISOString();
  const by = { kind: "user" as const, deviceId: DeviceId.make(input.deviceId) };
  const undoes = BatchIdSchema.make(input.batchId);
  const events: Event[] = [];

  for (const revert of plan.reverts) {
    if (revert.type === "task.updated") {
      events.push({
        v: 1,
        type: "task.updated",
        id: generateEventId(),
        at: nowIso,
        by,
        undoes,
        taskId: revert.taskId,
        set: revert.set,
      });
      continue;
    }
    if (revert.type === "project.updated") {
      events.push({
        v: 1,
        type: "project.updated",
        id: generateEventId(),
        at: nowIso,
        by,
        undoes,
        projectId: revert.projectId,
        set: revert.set,
      });
      continue;
    }
    if (revert.type === "page.updated") {
      events.push({
        v: 1,
        type: "page.updated",
        id: generateEventId(),
        at: nowIso,
        by,
        undoes,
        pageId: revert.pageId,
        set: revert.set,
      });
      continue;
    }
    events.push({
      v: 1,
      type: "chat.updated",
      id: generateEventId(),
      at: nowIso,
      by,
      undoes,
      chatId: revert.chatId,
      set: revert.set,
    });
  }

  return events;
}
