import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { planBatch, stampBatch, type BatchCommand } from "./batch.ts";
import { selectDayEntries, stackDayId, taskDayEntryId } from "./dailyStack.ts";
import { emptyFolded, foldEvents, type FoldedEntities } from "./fold.ts";
import { BatchId, DeviceId, EventId, TaskId, type EventId as EventIdentity } from "./ids.ts";
import { deriveEntryTime, findIntervalOverlaps } from "./stackPlayer.ts";
import { latestWritesFromEvents, planUndo } from "./undo.ts";

const taskA = TaskId.make("t_AAAAAAA1");
const taskB = TaskId.make("t_BBBBBBB2");
const taskC = TaskId.make("t_CCCCCCC3");
const dayId = stackDayId("2026-11-10", "Pacific/Auckland");
const tomorrowId = stackDayId("2026-11-11", "Pacific/Auckland");
const actorA = { kind: "user" as const, deviceId: DeviceId.make("offline-a") };
const actorB = { kind: "user" as const, deviceId: DeviceId.make("offline-b") };
const counters = new Map<string, number>();

function nextEventId(device: string): EventIdentity {
  const prefix = device === actorA.deviceId ? "A" : device === actorB.deviceId ? "B" : "C";
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return EventId.make(`${prefix}${String(next).padStart(25, "0")}`);
}

function apply(
  state: FoldedEntities,
  commands: readonly BatchCommand[],
  actor = actorA,
  now = "2026-11-10T00:00:00.000Z",
  batchId?: string,
  undoes?: string,
): FoldedEntities {
  const result = planBatch(state, commands, {
    actor,
    now,
    ...(batchId ? { batchId: BatchId.make(batchId) } : {}),
    ...(undoes ? { undoes: BatchId.make(undoes) } : {}),
  });
  if (Result.isFailure(result)) throw new Error(JSON.stringify(result.failure));
  const stamped = stampBatch(result.success.drafts, {
    observedMaxAt: state.events.at(-1)?.at ?? null,
    now,
    eventIds: result.success.drafts.map(() => nextEventId(actor.deviceId)),
  });
  if (Result.isFailure(stamped)) throw new Error(JSON.stringify(stamped.failure));
  return foldEvents([...state.events, ...stamped.success]);
}

function seed(assemble = true): FoldedEntities {
  return apply(emptyFolded(), [
    ...[taskA, taskB, taskC].map((taskId) => ({
      type: "task.create" as const,
      taskId,
      input: { title: taskId, estimateMinutes: 30, dueDate: "2026-11-12" },
    })),
    { type: "preferences.update", set: { automaticBreaks: false } },
    ...(assemble
      ? [
          { type: "day.ensure" as const, date: "2026-11-10", timezone: "Pacific/Auckland" },
          { type: "day.assemble" as const, dayId, templateId: null },
        ]
      : []),
  ]);
}

function merge(left: FoldedEntities, right: FoldedEntities): FoldedEntities {
  const forward = foldEvents([...left.events, ...right.events]);
  const reverse = foldEvents([...right.events, ...left.events, ...left.events]);
  expect(forward).toEqual(reverse);
  return forward;
}

describe("offline daily-stack convergence through the shared planner", () => {
  it("merges independently assembled days with one semantic copy of each routine and task", () => {
    const initial = seed(false);
    const commands: readonly BatchCommand[] = [
      { type: "day.ensure", date: "2026-11-10", timezone: "Pacific/Auckland" },
      { type: "day.assemble", dayId },
    ];
    const left = apply(initial, commands, actorA, "2026-11-10T01:00:00.000Z");
    const right = apply(initial, commands, actorB, "2026-11-10T01:00:00.000Z");
    const combined = merge(left, right);
    expect(combined.days.size).toBe(1);
    expect(selectDayEntries(combined.dayEntries, dayId)).toHaveLength(6);
    for (const id of [taskA, taskB, taskC]) {
      expect(
        selectDayEntries(combined.dayEntries, dayId).filter((entry) => entry.taskId === id),
      ).toHaveLength(1);
    }
    expect(combined.events.length).toBe(
      left.events.length + right.events.length - initial.events.length,
    );
    for (const [id, task] of initial.tasks)
      expect(combined.tasks.get(id)).toMatchObject({
        ...task,
        scheduledDate: "2026-11-10",
        updatedAt: combined.tasks.get(id)!.updatedAt,
      });
  });

  it("converges independent moves and conflicting allocations using event order", () => {
    const initial = seed();
    const left = apply(
      initial,
      [
        { type: "day.move", entryId: taskDayEntryId(dayId, taskA), beforeEntryId: null },
        {
          type: "day.update",
          entryId: taskDayEntryId(dayId, taskB),
          set: { allocationMinutes: 45 },
        },
      ],
      actorA,
      "2026-11-10T01:00:00.000Z",
    );
    const right = apply(
      initial,
      [
        {
          type: "day.move",
          entryId: taskDayEntryId(dayId, taskC),
          beforeEntryId: taskDayEntryId(dayId, taskA),
        },
        {
          type: "day.update",
          entryId: taskDayEntryId(dayId, taskB),
          set: { allocationMinutes: 20 },
        },
      ],
      actorB,
      "2026-11-10T01:00:00.000Z",
    );
    const combined = merge(left, right);
    expect(selectDayEntries(combined.dayEntries, dayId).map((entry) => entry.taskId)).toEqual([
      taskC,
      taskB,
      taskA,
    ]);
    expect(combined.dayEntries.get(taskDayEntryId(dayId, taskB))?.allocationMinutes).toBe(20);
    expect([...combined.tasks]).toEqual([...initial.tasks]);
  });

  it("merges two Tomorrow actions into one commitment while retaining source-day effort", () => {
    const running = apply(
      seed(),
      [
        {
          type: "player.play",
          entryId: taskDayEntryId(dayId, taskA),
          intervalId: "source-run",
          deviceId: actorA.deviceId,
        },
      ],
      actorA,
      "2026-11-10T01:00:00.000Z",
    );
    const command: BatchCommand = { type: "day.tomorrow", entryId: taskDayEntryId(dayId, taskA) };
    const left = apply(running, [command], actorA, "2026-11-10T01:10:00.000Z");
    const right = apply(running, [command], actorB, "2026-11-10T01:12:00.000Z");
    const combined = merge(left, right);
    const commitment = combined.dayEntries.get(taskDayEntryId(tomorrowId, taskA))!;
    expect(selectDayEntries(combined.dayEntries, tomorrowId)).toHaveLength(1);
    expect(commitment.allocationMinutes).toBe(20);
    expect(combined.workIntervals.get("source-run")?.endedAt).toBe("2026-11-10T01:10:00.000Z");
    const intervals = [...combined.workIntervals.values()];
    expect(
      deriveEntryTime(
        combined.dayEntries.get(taskDayEntryId(dayId, taskA))!,
        intervals,
        "2026-11-10T02:00:00.000Z",
      ).actualSeconds,
    ).toBe(600);
    expect(deriveEntryTime(commitment, intervals, "2026-11-10T02:00:00.000Z").actualSeconds).toBe(
      0,
    );
    const retried = apply(combined, [command], actorA, "2026-11-10T02:00:00.000Z");
    expect(retried.events).toEqual(combined.events);
    expect(combined.tasks.get(taskA)?.dueDate).toBe("2026-11-12");
  });

  it("retains conflicting offline runs without summing overlap and refuses another known remote run", () => {
    const initial = seed();
    const entryId = taskDayEntryId(dayId, taskA);
    const left = apply(
      initial,
      [{ type: "player.play", entryId, intervalId: "offline-run-a", deviceId: actorA.deviceId }],
      actorA,
      "2026-11-10T01:00:00.000Z",
    );
    const right = apply(
      initial,
      [{ type: "player.play", entryId, intervalId: "offline-run-b", deviceId: actorB.deviceId }],
      actorB,
      "2026-11-10T01:05:00.000Z",
    );
    const combined = merge(left, right);
    const intervals = [...combined.workIntervals.values()];
    const now = "2026-11-10T01:10:00.000Z";
    expect(combined.workIntervals.size).toBe(2);
    expect(deriveEntryTime(combined.dayEntries.get(entryId)!, intervals, now)).toMatchObject({
      actualSeconds: 600,
      overlaps: [["offline-run-a", "offline-run-b"]],
    });
    expect(findIntervalOverlaps(intervals, now)).toEqual([["offline-run-a", "offline-run-b"]]);
    const rejected = planBatch(
      combined,
      [
        {
          type: "player.play",
          entryId: taskDayEntryId(dayId, taskB),
          intervalId: "third-run",
          deviceId: actorA.deviceId,
        },
      ],
      { actor: actorA, now },
    );
    expect(Result.isFailure(rejected) && rejected.failure.code).toBe("entity_conflict");
    expect(combined.workIntervals.has("third-run")).toBe(false);
  });

  it("stops an unseen offline interval on remote completion and Undo preserves historical time", () => {
    const initial = seed();
    const entryId = taskDayEntryId(dayId, taskA);
    const offline = apply(
      initial,
      [{ type: "player.play", entryId, intervalId: "unseen-run", deviceId: actorA.deviceId }],
      actorA,
      "2026-11-10T01:00:00.000Z",
    );
    const completed = apply(
      initial,
      [{ type: "task.update", input: { taskId: taskA, status: "done" } }],
      actorB,
      "2026-11-10T01:10:00.000Z",
      "remote-completion",
    );
    const combined = merge(offline, completed);
    expect(combined.dayEntries.get(entryId)?.status).toBe("done");
    expect(combined.workIntervals.get("unseen-run")?.endedAt).toBe("2026-11-10T01:10:00.000Z");
    const completedBatch = combined.events.filter((event) => event.batch === "remote-completion");
    const undo = planUndo(completedBatch, combined, latestWritesFromEvents(combined.events));
    const taskRevert = undo.reverts.find(
      (revert) => revert.type === "task.updated" && revert.taskId === taskA,
    );
    if (!taskRevert || taskRevert.type !== "task.updated")
      throw new Error("Undo did not restore the task");
    const reopened = apply(
      combined,
      [{ type: "task.update", input: { taskId: taskA, ...taskRevert.set } }],
      actorB,
      "2026-11-10T01:15:00.000Z",
      "undo-completion",
      "remote-completion",
    );
    expect(reopened.tasks.get(taskA)?.status).toBe("todo");
    expect(reopened.workIntervals.get("unseen-run")?.endedAt).toBe("2026-11-10T01:10:00.000Z");
    expect(
      deriveEntryTime(
        reopened.dayEntries.get(entryId)!,
        [...reopened.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 600, running: false });
  });

  it("closes a stale offline start after remote completion with zero time and a visible review reason", () => {
    const initial = seed();
    const entryId = taskDayEntryId(dayId, taskA);
    const offline = apply(
      initial,
      [{ type: "player.play", entryId, intervalId: "stale-run", deviceId: actorA.deviceId }],
      actorA,
      "2026-11-10T01:15:00.000Z",
    );
    const completed = apply(
      initial,
      [{ type: "task.update", input: { taskId: taskA, status: "done" } }],
      actorB,
      "2026-11-10T01:10:00.000Z",
    );
    const combined = merge(offline, completed);
    expect(combined.workIntervals.get("stale-run")).toMatchObject({
      endedAt: "2026-11-10T01:15:00.000Z",
      reviewReason: "task_terminal_before_start",
    });
    expect(
      deriveEntryTime(
        combined.dayEntries.get(entryId)!,
        [...combined.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 0, running: false, needsClockReview: true });
    const corrected = apply(
      combined,
      [{ type: "player.correct", intervalId: "stale-run", seconds: 0 }],
      actorA,
      "2026-11-10T02:00:00.000Z",
    );
    expect(
      deriveEntryTime(
        corrected.dayEntries.get(entryId)!,
        [...corrected.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 0, running: false, needsClockReview: false });
  });

  it("keeps a later start running when a reopen follows the old completion before that start", () => {
    const initial = seed();
    const entryId = taskDayEntryId(dayId, taskA);
    const offline = apply(
      initial,
      [{ type: "player.play", entryId, intervalId: "after-reopen", deviceId: actorA.deviceId }],
      actorA,
      "2026-11-10T01:15:00.000Z",
    );
    const completed = apply(
      initial,
      [{ type: "task.update", input: { taskId: taskA, status: "done" } }],
      actorB,
      "2026-11-10T01:10:00.000Z",
    );
    const reopened = apply(
      completed,
      [{ type: "task.update", input: { taskId: taskA, status: "todo" } }],
      actorB,
      "2026-11-10T01:12:00.000Z",
    );
    const combined = merge(offline, reopened);
    expect(combined.tasks.get(taskA)?.status).toBe("todo");
    expect(combined.workIntervals.get("after-reopen")?.endedAt).toBeNull();
    expect(
      deriveEntryTime(
        combined.dayEntries.get(entryId)!,
        [...combined.workIntervals.values()],
        "2026-11-10T01:25:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 600, running: true, needsClockReview: false });
  });
});
