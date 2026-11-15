import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { planBatch, stampBatch, type BatchCommand } from "./batch.ts";
import { foldEvents, parseEventLine } from "./fold.ts";
import { ChatId, DeviceId, EventId, TaskId } from "./ids.ts";
import type { Event } from "./events.ts";
import {
  assistantMessageId,
  pageThreadMessages,
  reconcileThreadMessages,
  selectThreadMessages,
  threadMessageKey,
  type ThreadMessage,
  groupThreadTasks,
  PERSONAL_THREAD_ID,
  selectThreadHeadings,
  selectThreadHistory,
  selectThreadTasks,
} from "./thread.ts";
import { latestWritesFromEvents, planUndo } from "./undo.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("thread-test") };
const taskId = TaskId.make("t_AAAAAAA1");

function envelope(n: number) {
  return {
    v: 1 as const,
    id: EventId.make(String(n).padStart(26, "0")),
    at: `2020-01-${String(n).padStart(2, "0")}T12:00:00.000Z`,
    by: actor,
  };
}

function created(n = 1): Event {
  return {
    ...envelope(n),
    type: "task.created",
    taskId,
    title: "Book the dentist",
    projectId: null,
    status: "todo",
    quadrant: null,
    position: "n",
  };
}

function commit(commands: readonly BatchCommand[], events: readonly Event[] = []) {
  const planned = planBatch(foldEvents(events), commands, { actor });
  if (Result.isFailure(planned)) throw new Error(planned.failure.message);
  const stamped = stampBatch(planned.success.drafts, {
    now: "2026-10-15T00:00:00.000Z",
    observedMaxAt: events.at(-1)?.at ?? null,
    eventIds: planned.success.drafts.map((_, index) => envelope(events.length + index + 1).id),
  });
  if (Result.isFailure(stamped)) throw new Error(stamped.failure.message);
  return [...events, ...stamped.success];
}

describe("permanent task thread", () => {
  it("interleaves all existing conversation with completion events without a recent-history cutoff", () => {
    const legacyChat = ChatId.make("c_AAAAAAA1");
    const events: Event[] = [
      created(),
      { ...envelope(2), type: "chat.created", chatId: legacyChat, projectId: null },
      {
        ...envelope(3),
        type: "chat.message",
        chatId: legacyChat,
        messageId: "first",
        role: "user",
        text: "Make time for this.",
      },
      { ...envelope(4), type: "task.updated", taskId, set: { status: "done" } },
      {
        ...envelope(5),
        type: "chat.message",
        chatId: legacyChat,
        messageId: "reply",
        role: "assistant",
        text: "Done.",
      },
      {
        ...envelope(6),
        type: "task.updated",
        taskId,
        set: { notes: "Later edit", status: "done" },
      },
    ];
    const reloaded = foldEvents(
      events.map((event) => {
        const parsed = parseEventLine(JSON.stringify(event));
        if (!parsed.ok) throw new Error("Invalid fixture");
        return parsed.event;
      }),
    );
    expect(selectThreadHistory(reloaded).map((entry) => entry.kind)).toEqual([
      "message",
      "completed",
      "message",
    ]);
    expect(selectThreadHistory(reloaded)[1]).toMatchObject({
      taskId,
      title: "Book the dentist",
      at: envelope(4).at,
    });
    expect(selectThreadTasks(reloaded)).toEqual([]);
  });

  it("keeps both completion moments after reopen, rename, re-complete, and delete", () => {
    const events: Event[] = [
      created(),
      { ...envelope(2), type: "task.updated", taskId, set: { status: "done" } },
      {
        ...envelope(3),
        type: "task.updated",
        taskId,
        set: { status: "todo", title: "Book a different dentist" },
      },
    ];
    expect(selectThreadTasks(foldEvents(events)).map((task) => task.id)).toEqual([taskId]);
    events.push(
      { ...envelope(4), type: "task.updated", taskId, set: { status: "done" } },
      { ...envelope(5), type: "task.updated", taskId, set: { deleted: true } },
    );
    expect(
      selectThreadHistory(foldEvents(events))
        .filter((entry) => entry.kind === "completed")
        .map((entry) => entry.title),
    ).toEqual(["Book the dentist", "Book a different dentist"]);
  });

  it("orders tasks and heading groups by priority, including tasks with multiple tags", () => {
    const events = commit([
      { type: "task.create", taskId, input: { title: "Low", tags: ["Work"] } },
      {
        type: "task.create",
        taskId: TaskId.make("t_AAAAAAA2"),
        input: { title: "High", tags: ["Home", "Work"] },
      },
      { type: "task.create", taskId: TaskId.make("t_AAAAAAA3"), input: { title: "Middle" } },
      {
        type: "task.update",
        input: { taskId: TaskId.make("t_AAAAAAA2"), placement: { kind: "top" } },
      },
      {
        type: "task.update",
        input: { taskId: TaskId.make("t_AAAAAAA3"), placement: { kind: "before", taskId } },
      },
    ]);
    const tasks = selectThreadTasks(foldEvents(events));
    expect(tasks.map((task) => task.title)).toEqual(["High", "Middle", "Low"]);
    expect(
      groupThreadTasks(tasks, ["Empty"]).map((group) => [
        group.heading,
        group.tasks.map((task) => task.title),
      ]),
    ).toEqual([
      ["Home", ["High"]],
      ["Work", ["High", "Low"]],
      [null, ["Middle"]],
      ["Empty", []],
    ]);
  });

  it("persists empty headings and task tags, and undoes tags after JSON reload", () => {
    const base = commit([
      { type: "chat.create", chatId: PERSONAL_THREAD_ID, input: { projectId: null } },
      { type: "chat.update", input: { chatId: PERSONAL_THREAD_ID, headings: ["Work", "Someday"] } },
      { type: "task.create", taskId, input: { title: "Tagged task" } },
    ]);
    const updated = commit(
      [{ type: "task.update", input: { taskId, tags: ["Work", "Work"] } }],
      base,
    );
    const events = JSON.parse(JSON.stringify(updated)) as Event[];
    const state = foldEvents(events);
    expect(state.tasks.get(taskId)?.tags).toEqual(["Work"]);
    expect(selectThreadHeadings(state)).toEqual(["Work", "Someday"]);
    const undo = planUndo(events.slice(base.length), state, latestWritesFromEvents(events));
    expect(undo.reverts).toEqual([{ type: "task.updated", taskId, set: { tags: [] } }]);
    expect(undo.skipped).toEqual([]);
    const done = commit([{ type: "task.update", input: { taskId, status: "done" } }], events);
    expect(selectThreadHeadings(foldEvents(done))).toEqual(["Work", "Someday"]);
  });

  it("preserves the conversation when offline devices initialize the same thread", () => {
    const state = foldEvents([
      { ...envelope(1), type: "chat.created", chatId: PERSONAL_THREAD_ID, projectId: null },
      {
        ...envelope(2),
        type: "chat.message",
        chatId: PERSONAL_THREAD_ID,
        messageId: "saved",
        role: "user",
        text: "Keep this message",
      },
      { ...envelope(3), type: "chat.created", chatId: PERSONAL_THREAD_ID, projectId: null },
    ]);
    expect(selectThreadHistory(state)).toHaveLength(1);
    expect(state.chats.get(PERSONAL_THREAD_ID)?.messages[0]?.text).toBe("Keep this message");
  });
});

function messageFixture(index: number, chatId = PERSONAL_THREAD_ID): ThreadMessage {
  return {
    chatId,
    message: {
      id: `message-${String(index).padStart(4, "0")}`,
      at: "2026-11-10T12:00:00.000Z",
      role: "assistant",
      text: "The same reply",
    },
  };
}

describe("bounded conversation messages", () => {
  it("keeps equal-text messages and orders equal timestamps by chat then message identity", () => {
    const otherChat = ChatId.make("c_AAAAAAA2");
    const messages = reconcileThreadMessages([
      messageFixture(2, otherChat),
      messageFixture(3),
      messageFixture(1),
    ]);
    expect(messages.map(threadMessageKey)).toEqual([
      threadMessageKey(messageFixture(1)),
      threadMessageKey(messageFixture(3)),
      threadMessageKey(messageFixture(2, otherChat)),
    ]);
    expect(messages).toHaveLength(3);
  });

  it("pages 50 at a time, caps retention at 150, and keeps the visible message", () => {
    const messages = Array.from({ length: 400 }, (_, index) => messageFixture(index));
    let window = pageThreadMessages(messages, [], "latest");
    expect(window.messages).toEqual(messages.slice(350));
    expect(window.hasNewer).toBe(false);
    for (let index = 0; index < 6; index++) {
      const anchor = threadMessageKey(window.messages[0]!);
      window = pageThreadMessages(messages, window.messages, "older", anchor);
      expect(window.messages.length).toBeLessThanOrEqual(150);
      expect(window.messages.some((entry) => threadMessageKey(entry) === anchor)).toBe(true);
    }
    expect(window.messages).toEqual(messages.slice(50, 200));
    window = pageThreadMessages(
      messages,
      window.messages,
      "newer",
      threadMessageKey(window.messages.at(-1)!),
    );
    expect(window.messages).toEqual(messages.slice(100, 250));
  });

  it("reconciles streamed replies by identity even when another reply has identical text", () => {
    const stream = {
      ...messageFixture(1),
      message: { ...messageFixture(1).message, id: assistantMessageId("turn-1") },
    };
    const older = messageFixture(2);
    expect(reconcileThreadMessages([older], stream)).toHaveLength(2);
    const durable = { ...stream, message: { ...stream.message, text: "Full durable reply" } };
    expect(reconcileThreadMessages([older, durable], stream)).toEqual([older, durable]);
  });

  it("reads persisted legacy chats without synthesizing completion rows", () => {
    const chatId = ChatId.make("c_AAAAAAA1");
    const state = foldEvents([
      created(),
      { ...envelope(2), type: "chat.created", chatId, projectId: null },
      {
        ...envelope(3),
        type: "chat.message",
        chatId,
        messageId: "legacy",
        role: "system",
        text: "Keep this reply",
      },
      { ...envelope(4), type: "task.updated", taskId, set: { status: "done" } },
    ]);
    expect(selectThreadMessages(state).map((entry) => entry.message.id)).toEqual(["legacy"]);
  });
});
