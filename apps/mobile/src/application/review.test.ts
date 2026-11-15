import {
  BatchId,
  reviewItemId,
  TaskId,
  emptyFolded,
  foldEvents,
  type BatchCommand,
  type Event,
} from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";
import { createLocalMutationWriter, localUserActor } from "./mutations";
import { decideReview } from "./review";

function harness() {
  let folded = emptyFolded();
  let fail = false;
  const writer = createLocalMutationWriter({
    readSnapshot: async () => ({
      folded,
      deviceId: "review-test",
      lastSeenAt: folded.events.at(-1)?.at ?? null,
    }),
    commitBatch: async (events) => {
      if (fail) throw new Error("storage unavailable");
      folded = foldEvents([...folded.events, ...events]);
      return folded;
    },
    publish: (next) => {
      folded = next;
    },
    sessionGeneration: () => 0,
    now: () => "2026-11-11T08:00:00.000Z",
  });
  const store = {
    get state() {
      return { folded };
    },
    executeLocalCommands: (
      commands: readonly BatchCommand[],
      context?: { readonly batchId?: BatchId },
    ) => writer.execute(commands, localUserActor("review-test"), context),
  };
  return {
    store,
    undo: (batchId: string, events: readonly Event[]) =>
      writer.executeUndo(
        BatchId.make(batchId),
        events,
        localUserActor("review-test"),
        "Undo review choice",
      ),
    set fail(value: boolean) {
      fail = value;
    },
  };
}
const id = reviewItemId("gmail", "mail:1");
const receive: BatchCommand = {
  type: "review.receive",
  input: {
    id,
    taskId: null,
    source: "gmail",
    sourceId: "mail:1",
    sourceRevision: "1",
    title: "Client request",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/1",
    receivedAt: "2026-11-11T07:00:00.000Z",
  },
};
const decision = {
  disposition: "today" as const,
  reason: "Unblock the client",
  revisitOn: null,
  date: "2026-11-11",
  timezone: "Pacific/Auckland",
};

describe("local review choices", () => {
  it("persists a linked task, daily selection, decision and receipt in one transaction", async () => {
    const h = harness();
    await h.store.executeLocalCommands([receive]);
    const item = h.store.state.folded.reviewItems.get(id)!;
    h.fail = true;
    await expect(decideReview(h.store, item, decision)).rejects.toThrow(
      "Local changes could not be saved",
    );
    expect(h.store.state.folded.tasks.size).toBe(0);
    expect(h.store.state.folded.dayEntries.size).toBe(0);
    expect(h.store.state.folded.reviewItems.get(id)?.disposition).toBe("pending");
    h.fail = false;
    const result = await decideReview(h.store, item, decision);
    const linked = h.store.state.folded.reviewItems.get(id)!;
    expect(linked.taskId).not.toBeNull();
    expect(linked.disposition).toBe("today");
    expect(
      [...h.store.state.folded.dayEntries.values()].filter(
        (entry) => entry.taskId === linked.taskId,
      ),
    ).toHaveLength(1);
    expect([...h.store.state.folded.chats.values()][0]?.messages).toHaveLength(1);
    expect(foldEvents(h.store.state.folded.events).reviewItems.get(id)).toEqual(linked);
    await h.undo(result.batchId, result.events);
    expect(h.store.state.folded.reviewItems.get(id)).toMatchObject({
      taskId: null,
      disposition: "pending",
    });
    expect([...h.store.state.folded.tasks.values()].every((task) => task.deletedAt !== null)).toBe(
      true,
    );
    expect(
      [...h.store.state.folded.dayEntries.values()].every((entry) => entry.status === "removed"),
    ).toBe(true);
  });
  it("retains a dated deferral without creating work and rejects a stale choice", async () => {
    const h = harness();
    await h.store.executeLocalCommands([receive]);
    const item = h.store.state.folded.reviewItems.get(id)!;
    await decideReview(h.store, item, {
      ...decision,
      disposition: "later",
      reason: "Wait for the brief",
      revisitOn: "2026-11-13",
    });
    expect(h.store.state.folded.tasks.size).toBe(0);
    expect(h.store.state.folded.dayEntries.size).toBe(0);
    await expect(decideReview(h.store, item, decision)).rejects.toThrow("changed");
  });
  it("does not choose a completed linked task or silently remove an existing daily commitment", async () => {
    const h = harness();
    const taskId = TaskId.make("t_ABCDEFGH");
    await h.store.executeLocalCommands([
      { type: "task.create", taskId, input: { title: "Client request" } },
      { ...receive, input: { ...receive.input, taskId } },
    ]);
    await decideReview(h.store, h.store.state.folded.reviewItems.get(id)!, decision);
    await decideReview(h.store, h.store.state.folded.reviewItems.get(id)!, {
      ...decision,
      disposition: "waiting",
      reason: "Waiting for reply",
    });
    expect(h.store.state.folded.dayEntries.size).toBe(1);
    await h.store.executeLocalCommands([
      { type: "task.update", input: { taskId, status: "done" } },
    ]);
    await expect(
      decideReview(h.store, h.store.state.folded.reviewItems.get(id)!, decision),
    ).rejects.toThrow("no longer available");
  });
});
