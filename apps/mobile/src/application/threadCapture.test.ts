import {
  BatchId,
  DeviceId,
  EventId,
  PERSONAL_THREAD_ID,
  TaskId,
  emptyFolded,
  foldEvents,
  planBatch,
  stampBatch,
  type BatchCommand,
  type FoldedEntities,
} from "@yatma/core";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { captureThreadTask, showThreadTasks, type ThreadCaptureStore } from "./threadCapture";

function fixtureStore() {
  let folded: FoldedEntities = emptyFolded();
  let failCommit = false;
  let commitCount = 0;
  let sequence = 0;
  const actor = { kind: "user" as const, deviceId: DeviceId.make("capture-test") };
  const store: ThreadCaptureStore = {
    get state() {
      return { folded };
    },
    executeLocalCommands: async (commands, context) => {
      const plan = planBatch(folded, commands, {
        actor,
        now: "2026-11-10T00:00:00.000Z",
        ...context,
      });
      if (Result.isFailure(plan)) throw new Error(plan.failure.message);
      const stamped = stampBatch(plan.success.drafts, {
        now: "2026-11-10T00:00:00.000Z",
        observedMaxAt: folded.events.at(-1)?.at ?? null,
        eventIds: plan.success.drafts.map(() => EventId.make(String(++sequence).padStart(26, "0"))),
      });
      if (Result.isFailure(stamped)) throw new Error(stamped.failure.message);
      if (failCommit) throw new Error("Injected transaction failure");
      commitCount++;
      folded = foldEvents([...folded.events, ...stamped.success]);
    },
  };
  return {
    store,
    setFail: (value: boolean) => {
      failCommit = value;
    },
    getCommits: () => commitCount,
  };
}

describe("offline thread capture", () => {
  it("commits task and receipt together, retries the same identity, and never partially publishes failure", async () => {
    const fixture = fixtureStore();
    const identity = {
      taskId: TaskId.make("t_AAAAAAA1"),
      messageId: "receipt-1",
      batchId: BatchId.make("capture-1"),
    };
    fixture.setFail(true);
    await expect(
      captureThreadTask(fixture.store, { title: "Book dentist", projectId: null }, identity),
    ).rejects.toThrow("Injected transaction failure");
    expect(fixture.store.state.folded.tasks.size).toBe(0);
    expect(fixture.store.state.folded.chats.size).toBe(0);
    expect(fixture.store.state.folded.reviewItems.size).toBe(0);
    fixture.setFail(false);
    await captureThreadTask(fixture.store, { title: "Book dentist", projectId: null }, identity);
    await captureThreadTask(fixture.store, { title: "Book dentist", projectId: null }, identity);
    expect(fixture.getCommits()).toBe(1);
    expect(fixture.store.state.folded.tasks.size).toBe(1);
    expect([...fixture.store.state.folded.reviewItems.values()]).toEqual([
      expect.objectContaining({
        taskId: identity.taskId,
        disposition: "pending",
        source: "capture",
      }),
    ]);
    expect(fixture.store.state.folded.chats.get(PERSONAL_THREAD_ID)?.messages).toEqual([
      expect.objectContaining({
        id: "receipt-1",
        role: "system",
        text: "Added to your tasks:\n[Book dentist](task:t_AAAAAAA1)",
      }),
    ]);
  });

  it("lists every open non-deleted task beyond 50 and reports status counts", async () => {
    const fixture = fixtureStore();
    const commands: BatchCommand[] = Array.from({ length: 55 }, (_, index) => ({
      type: "task.create",
      taskId: TaskId.make(`t_${String(index).padStart(8, "0")}`),
      input: { title: `Task ${index}` },
    }));
    await fixture.store.executeLocalCommands([
      ...commands,
      { type: "task.update", input: { taskId: TaskId.make("t_00000000"), status: "done" } },
      { type: "task.update", input: { taskId: TaskId.make("t_00000001"), deleted: true } },
      { type: "task.update", input: { taskId: TaskId.make("t_00000002"), status: "in_progress" } },
    ]);
    expect(await showThreadTasks(fixture.store, "show-1")).toEqual({
      messageId: "show-1",
      included: 53,
      remaining: 0,
    });
    const message = fixture.store.state.folded.chats.get(PERSONAL_THREAD_ID)?.messages[0];
    expect(message?.text.match(/\]\(task:/g)).toHaveLength(53);
    expect(message?.text).toContain("53 tasks (52 to do, 1 in progress)");
    expect(message?.text).not.toContain("task:t_00000000");
    expect(message?.text).not.toContain("task:t_00000001");
    expect(message?.text).toContain("task:t_00000054");
    const original = message?.text;
    await fixture.store.executeLocalCommands([
      { type: "task.update", input: { taskId: TaskId.make("t_00000002"), status: "done" } },
    ]);
    expect(fixture.store.state.folded.chats.get(PERSONAL_THREAD_ID)?.messages[0]?.text).toBe(
      original,
    );
  });

  it("does not publish a list on commit failure and retries without an agent or network", async () => {
    const fixture = fixtureStore();
    fixture.setFail(true);
    await expect(showThreadTasks(fixture.store, "list-retry")).rejects.toThrow(
      "Injected transaction failure",
    );
    expect(fixture.store.state.folded.chats.size).toBe(0);
    fixture.setFail(false);
    await showThreadTasks(fixture.store, "list-retry");
    expect(fixture.getCommits()).toBe(1);
    expect(fixture.store.state.folded.chats.get(PERSONAL_THREAD_ID)?.messages).toEqual([
      expect.objectContaining({
        id: "list-retry",
        role: "system",
        text: expect.stringContaining("open backlog is empty"),
      }),
    ]);
  });
});
