import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";

import { planBatch, stampBatch } from "./batch.ts";
import type { BatchCommand } from "./batch.ts";
import { emptyFolded, foldEvents } from "./fold.ts";
import type { FoldedEntities } from "./fold.ts";
import { ChatId, DeviceId, EventId, TaskId } from "./ids.ts";
import { selectDayEntries, stackDayId, taskDayEntryId, forecastDay } from "./dailyStack.ts";
import { deriveEntryTime, findIntervalOverlaps } from "./stackPlayer.ts";
import { ADMIN_TEMPLATE, defaultStackPreferences } from "./stackSchemas.ts";
import { latestWritesFromEvents, planUndo } from "./undo.ts";
import { nextBreakThreshold, actualWorkSinceBreak } from "./stackTemplates.ts";
import { addCalendarDays } from "./dates.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("device-a") };
const A = TaskId.make("t_AAAAAAA1");
const B = TaskId.make("t_BBBBBBB2");
const C = TaskId.make("t_CCCCCCC3");
const dayId = stackDayId("2026-11-10", "Pacific/Auckland");
const tomorrowId = stackDayId("2026-11-11", "Pacific/Auckland");
let nextId = 1;
function eventId(): EventId {
  return EventId.make(String(nextId++).padStart(26, "0"));
}
function apply(
  state: FoldedEntities,
  commands: readonly BatchCommand[],
  now = "2026-11-10T00:00:00.000Z",
): FoldedEntities {
  const planned = planBatch(state, commands, { actor, now });
  if (Result.isFailure(planned)) throw new Error(JSON.stringify(planned.failure));
  const stamped = stampBatch(planned.success.drafts, {
    observedMaxAt: state.events.at(-1)?.at ?? null,
    now,
    eventIds: planned.success.drafts.map(eventId),
  });
  if (Result.isFailure(stamped)) throw new Error(JSON.stringify(stamped.failure));
  return foldEvents([...state.events, ...stamped.success]);
}
function initial(count = 3, allocation = 30): FoldedEntities {
  const ids = [A, B, C].slice(0, count);
  return apply(emptyFolded(), [
    ...ids.map((taskId) => ({
      type: "task.create" as const,
      taskId,
      input: { title: taskId, estimateMinutes: allocation },
    })),
    { type: "day.ensure", date: "2026-11-10", timezone: "Pacific/Auckland" },
    { type: "day.assemble", dayId, templateId: null },
  ]);
}
function play(
  state: FoldedEntities,
  taskId: typeof A,
  intervalId: string,
  now: string,
): FoldedEntities {
  return apply(
    state,
    [
      {
        type: "player.play",
        entryId: taskDayEntryId(dayId, taskId),
        intervalId,
        deviceId: actor.deviceId,
      },
    ],
    now,
  );
}

describe("daily stack and player policy", () => {
  it("instantiates the admin opening once and preserves later manual allocations and global priority", () => {
    let state = initial();
    const positions = [...state.tasks.values()].map((task) => task.position);
    state = apply(state, [{ type: "day.assemble", dayId, templateId: "admin", append: true }]);
    const entries = selectDayEntries(state.dayEntries, dayId);
    expect(entries.slice(0, 3).map((entry) => [entry.title, entry.allocationMinutes])).toEqual([
      ["Mindfulness", 10],
      ["Reprioritise", 5],
      ["Clear email", 30],
    ]);
    state = apply(state, [
      { type: "day.update", entryId: entries[2]!.id, set: { allocationMinutes: 40 } },
      {
        type: "day.move",
        entryId: taskDayEntryId(dayId, C),
        beforeEntryId: taskDayEntryId(dayId, A),
      },
    ]);
    const count = state.events.length;
    state = apply(state, [{ type: "day.assemble", dayId }]);
    expect(state.events).toHaveLength(count);
    expect(state.dayEntries.get(entries[2]!.id)?.allocationMinutes).toBe(40);
    expect(ADMIN_TEMPLATE.items[2]!.allocationMinutes).toBe(30);
    expect([...state.tasks.values()].map((task) => task.position)).toEqual(positions);
  });

  it("puts a newly started item first and interrupted work immediately next", () => {
    let state = play(initial(3), A, "first", "2026-11-10T01:00:00.000Z");
    state = play(state, C, "second", "2026-11-10T01:05:00.000Z");
    expect(selectDayEntries(state.dayEntries, dayId).map((entry) => entry.taskId)).toEqual([
      C,
      A,
      B,
    ]);
    expect(state.workIntervals.get("first")?.endedAt).toBe("2026-11-10T01:05:00.000Z");
    state = play(state, B, "third", "2026-11-10T01:10:00.000Z");
    expect(selectDayEntries(state.dayEntries, dayId).map((entry) => entry.taskId)).toEqual([
      B,
      C,
      A,
    ]);
  });

  it("logs 13 minutes from two intervals and excludes the 5-minute pause", () => {
    let state = play(initial(1), A, "run-1", "2026-11-10T01:00:00.000Z");
    state = apply(
      state,
      [{ type: "player.pause", entryId: taskDayEntryId(dayId, A) }],
      "2026-11-10T01:10:00.000Z",
    );
    state = play(state, A, "run-2", "2026-11-10T01:15:00.000Z");
    state = apply(
      state,
      [{ type: "player.pause", entryId: taskDayEntryId(dayId, A) }],
      "2026-11-10T01:18:00.000Z",
    );
    expect(
      deriveEntryTime(
        state.dayEntries.get(taskDayEntryId(dayId, A))!,
        [...state.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 13 * 60, remainingSeconds: 17 * 60, running: false });
  });

  it("shows overtime without completing and shifts later forecasts after extension", () => {
    let state = play(initial(2), A, "run-1", "2026-11-10T01:00:00.000Z");
    const now = "2026-11-10T01:34:00.000Z";
    const entry = state.dayEntries.get(taskDayEntryId(dayId, A))!;
    expect(deriveEntryTime(entry, [...state.workIntervals.values()], now).overtimeSeconds).toBe(
      4 * 60,
    );
    expect(state.tasks.get(A)?.status).toBe("todo");
    state = apply(state, [{ type: "player.extend", entryId: entry.id, minutes: 10 }], now);
    expect(state.tasks.get(A)?.estimateMinutes).toBe(30);
    expect(state.dayEntries.get(entry.id)?.allocationMinutes).toBe(40);
    const forecast = forecastDay(
      selectDayEntries(state.dayEntries, dayId),
      [...state.workIntervals.values()],
      now,
    );
    expect(forecast[1]!.startsAt).toBe("2026-11-10T01:40:00.000Z");
  });

  it("moves Later to the tail repeatedly and requires a new allowance after exhaustion", () => {
    let state = play(initial(), A, "run-1", "2026-11-10T01:00:00.000Z");
    const entryId = taskDayEntryId(dayId, A);
    state = apply(state, [{ type: "player.later", entryId }], "2026-11-10T01:10:00.000Z");
    expect(selectDayEntries(state.dayEntries, dayId).map((entry) => entry.taskId)).toEqual([
      B,
      C,
      A,
    ]);
    expect(
      deriveEntryTime(
        state.dayEntries.get(entryId)!,
        [...state.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ).actualSeconds,
    ).toBe(600);
    state = apply(state, [{ type: "day.move", entryId, beforeEntryId: taskDayEntryId(dayId, B) }]);
    state = play(state, A, "run-2", "2026-11-10T02:00:00.000Z");
    const failed = planBatch(state, [{ type: "player.later", entryId }], {
      actor,
      now: "2026-11-10T02:21:00.000Z",
    });
    expect(Result.isFailure(failed)).toBe(true);
    state = apply(
      state,
      [{ type: "player.later", entryId, allocationMinutes: 5 }],
      "2026-11-10T02:21:00.000Z",
    );
    expect(selectDayEntries(state.dayEntries, dayId).at(-1)?.taskId).toBe(A);
    expect(
      deriveEntryTime(
        state.dayEntries.get(entryId)!,
        [...state.workIntervals.values()],
        "2026-11-10T03:00:00.000Z",
      ).remainingSeconds,
    ).toBe(300);
  });

  it("transfers A then B atomically before tomorrow's email and preserves source actuals on retries", () => {
    let state = play(initial(), A, "run-1", "2026-11-10T01:00:00.000Z");
    state = apply(
      state,
      [
        { type: "day.ensure", date: "2026-11-11", timezone: "Pacific/Auckland" },
        { type: "day.assemble", dayId: tomorrowId, templateId: "admin" },
      ],
      "2026-11-10T01:05:00.000Z",
    );
    state = apply(
      state,
      [
        { type: "day.tomorrow", entryId: taskDayEntryId(dayId, A) },
        { type: "day.tomorrow", entryId: taskDayEntryId(dayId, B) },
      ],
      "2026-11-10T01:10:00.000Z",
    );
    const tomorrow = selectDayEntries(state.dayEntries, tomorrowId);
    expect(tomorrow.slice(0, 5).map((entry) => entry.taskId ?? entry.title)).toEqual([
      "Mindfulness",
      "Reprioritise",
      A,
      B,
      "Clear email",
    ]);
    expect(
      deriveEntryTime(
        state.dayEntries.get(taskDayEntryId(dayId, A))!,
        [...state.workIntervals.values()],
        "2026-11-10T03:00:00.000Z",
      ).actualSeconds,
    ).toBe(600);
    expect(
      deriveEntryTime(
        state.dayEntries.get(taskDayEntryId(tomorrowId, A))!,
        [...state.workIntervals.values()],
        "2026-11-10T03:00:00.000Z",
      ).actualSeconds,
    ).toBe(0);
    const count = state.events.length;
    state = apply(state, [{ type: "day.tomorrow", entryId: taskDayEntryId(dayId, A) }]);
    expect(state.events).toHaveLength(count);
    expect(state.tasks.get(A)?.dueDate).toBeNull();
  });

  it("exposes no draft when any later transfer command fails and leaves snapshot untouched", () => {
    const state = play(initial(), A, "run-1", "2026-11-10T01:00:00.000Z");
    const result = planBatch(
      state,
      [
        { type: "day.tomorrow", entryId: taskDayEntryId(dayId, A) },
        { type: "day.remove", entryId: "missing" },
      ],
      { actor, now: "2026-11-10T01:10:00.000Z" },
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(state.days.has(tomorrowId)).toBe(false);
    expect(state.workIntervals.get("run-1")?.endedAt).toBeNull();
  });

  it("converges semantic assembly identities without duplicate entries or colliding event IDs", () => {
    const state = apply(emptyFolded(), [{ type: "task.create", taskId: A, input: { title: "A" } }]);
    const commands: BatchCommand[] = [
      { type: "day.ensure", date: "2026-11-10", timezone: "Pacific/Auckland" },
      { type: "day.assemble", dayId },
    ];
    const left = apply(state, commands, "2026-11-10T01:00:00.000Z");
    const right = apply(state, commands, "2026-11-10T01:00:00.000Z");
    const merged = foldEvents([...left.events, ...right.events]);
    const reverse = foldEvents([...right.events, ...left.events]);
    expect([...merged.dayEntries]).toEqual([...reverse.dayEntries]);
    expect(
      selectDayEntries(merged.dayEntries, dayId).filter((entry) => entry.taskId === A),
    ).toHaveLength(1);
    expect(merged.events.length).toBe(
      left.events.length + right.events.length - state.events.length,
    );
  });

  it("completes linked entries and closes intervals in the shared task batch without restarting on reopen", () => {
    let state = play(initial(1), A, "run-1", "2026-11-10T01:00:00.000Z");
    const plan = planBatch(state, [{ type: "task.update", input: { taskId: A, status: "done" } }], {
      actor,
      now: "2026-11-10T01:10:00.000Z",
    });
    expect(Result.isSuccess(plan) && plan.success.drafts.map((draft) => draft.type)).toEqual([
      "task.updated",
      "dayEntry.updated",
      "workInterval.updated",
    ]);
    state = apply(
      state,
      [{ type: "task.update", input: { taskId: A, status: "done" } }],
      "2026-11-10T01:10:00.000Z",
    );
    state = apply(
      state,
      [{ type: "task.update", input: { taskId: A, status: "todo" } }],
      "2026-11-10T01:15:00.000Z",
    );
    expect(state.workIntervals.get("run-1")?.endedAt).toBe("2026-11-10T01:10:00.000Z");
    expect(state.tasks.get(A)?.status).toBe("todo");
  });

  it("reports overlapping offline runs and refuses a known remote active run", () => {
    let state = play(initial(1), A, "run-1", "2026-11-10T01:00:00.000Z");
    const entry = state.dayEntries.get(taskDayEntryId(dayId, A))!;
    const result = planBatch(
      state,
      [
        {
          type: "player.play",
          entryId: entry.id,
          intervalId: "run-2",
          deviceId: DeviceId.make("device-b"),
        },
      ],
      {
        actor: { kind: "user", deviceId: DeviceId.make("device-b") },
        now: "2026-11-10T01:05:00.000Z",
      },
    );
    expect(Result.isFailure(result)).toBe(true);
    const remote = {
      ...state.workIntervals.get("run-1")!,
      id: "run-2",
      deviceId: DeviceId.make("device-b"),
      startedAt: "2026-11-10T01:05:00.000Z",
    };
    const intervals = [...state.workIntervals.values(), remote];
    expect(deriveEntryTime(entry, intervals, "2026-11-10T01:10:00.000Z")).toMatchObject({
      actualSeconds: 600,
      overlaps: [["run-1", "run-2"]],
    });
    expect(findIntervalOverlaps(intervals, "2026-11-10T01:10:00.000Z")).toHaveLength(1);
  });

  it("keeps skipped generated breaks suppressed and preserves manual resized breaks", () => {
    let state = initial(3, 70);
    const generated = selectDayEntries(state.dayEntries, dayId).find(
      (entry) => entry.kind === "break",
    )!;
    expect(generated).toBeDefined();
    state = apply(state, [{ type: "day.remove", entryId: generated.id }]);
    state = apply(state, [
      { type: "player.extend", entryId: taskDayEntryId(dayId, A), minutes: 5 },
    ]);
    expect(state.dayEntries.get(generated.id)?.status).toBe("skipped");
    expect(state.days.get(dayId)?.suppressedBreakOrigins).toContain(generated.origin);
    state = apply(state, [
      { type: "day.add", dayId, kind: "break", entryId: "manual-break", allocationMinutes: 7 },
    ]);
    state = apply(state, [
      { type: "day.update", entryId: "manual-break", set: { allocationMinutes: 9 } },
      { type: "preferences.update", set: { automaticBreaks: false } },
    ]);
    expect(state.dayEntries.get("manual-break")).toMatchObject({
      allocationMinutes: 9,
      manual: true,
      status: "pending",
    });
  });

  it("uses calendar tomorrow across DST and separates independent scene preferences from runs", () => {
    expect(addCalendarDays("2026-09-26", 1)).toBe("2026-09-27");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    let state = play(initial(1), A, "run-1", "2026-11-10T01:00:00.000Z");
    const interval = state.workIntervals.get("run-1");
    state = apply(state, [
      { type: "preferences.update", set: { scene: "rain", muted: false, volume: 0.2 } },
    ]);
    expect(state.workIntervals.get("run-1")).toEqual(interval);
    expect(state.tasks.get(A)?.status).toBe("todo");
  });

  it("flags backwards clocks and supports explicit closed-interval correction", () => {
    let state = play(initial(1), A, "run-1", "2026-11-10T01:00:00.000Z");
    const entry = state.dayEntries.get(taskDayEntryId(dayId, A))!;
    expect(
      deriveEntryTime(entry, [...state.workIntervals.values()], "2026-11-10T00:00:00.000Z")
        .needsClockReview,
    ).toBe(true);
    state = apply(state, [{ type: "player.pause", entryId: entry.id }], "2026-11-10T01:10:00.000Z");
    state = apply(state, [{ type: "player.correct", intervalId: "run-1", seconds: 300 }]);
    expect(
      deriveEntryTime(entry, [...state.workIntervals.values()], "2026-11-10T03:00:00.000Z")
        .actualSeconds,
    ).toBe(300);
  });
});

describe("daily acceptance and compatibility fixtures", () => {
  it("keeps one semantic day when a device travels and retains the original planning timezone", () => {
    const state = initial(1);
    const next = apply(state, [
      { type: "day.ensure", date: "2026-11-10", timezone: "America/New_York" },
    ]);
    expect(next.days.size).toBe(1);
    expect(next.days.get(dayId)?.timezone).toBe("Pacific/Auckland");
  });

  it("preserves a manually edited target on tomorrow deferral", () => {
    let state = initial(1);
    state = apply(state, [
      { type: "day.ensure", date: "2026-11-11", timezone: "Pacific/Auckland" },
      { type: "day.add", dayId: tomorrowId, kind: "task", taskId: A, allocationMinutes: 45 },
    ]);
    const target = state.dayEntries.get(taskDayEntryId(tomorrowId, A))!;
    state = apply(state, [
      { type: "day.tomorrow", entryId: taskDayEntryId(dayId, A), allocationMinutes: 10 },
    ]);
    expect(state.dayEntries.get(target.id)).toEqual(target);
    expect(state.dayEntries.get(taskDayEntryId(dayId, A))?.status).toBe("deferred");
  });

  it("reconciles break settings without appending mid-day tasks or rewriting manual breaks", () => {
    let state = initial(3, 70);
    const generated = selectDayEntries(state.dayEntries, dayId).find(
      (entry) => entry.kind === "break",
    )!;
    state = apply(
      state,
      [{ type: "preferences.update", set: { breakMinutes: 8 } }],
      "2026-11-10T01:00:00.000Z",
    );
    expect(state.dayEntries.get(generated.id)?.allocationMinutes).toBe(8);
    const D = TaskId.make("t_DDDDDDD4");
    state = apply(state, [
      { type: "task.create", taskId: D, input: { title: "Midday capture" } },
      { type: "day.update", entryId: generated.id, set: { allocationMinutes: 9 } },
    ]);
    state = apply(state, [{ type: "preferences.update", set: { automaticBreaks: false } }]);
    expect(state.dayEntries.get(generated.id)).toMatchObject({
      allocationMinutes: 9,
      status: "pending",
      manual: true,
    });
    expect(selectDayEntries(state.dayEntries, dayId).some((entry) => entry.taskId === D)).toBe(
      false,
    );
  });

  it("records nudge dismissal once without rest and offers a later threshold", () => {
    let state = initial(1, 180);
    state = apply(state, [
      { type: "preferences.update", set: { workIntervalMinutes: 10, breakMinutes: 1 } },
    ]);
    state = play(state, A, "nudge-run", "2026-11-10T01:00:00.000Z");
    const entries = selectDayEntries(state.dayEntries, dayId, true);
    const preferences = state.stackPreferences.get("default")!;
    const now = "2026-11-10T01:10:00.000Z";
    const threshold = nextBreakThreshold(
      entries,
      [...state.workIntervals.values()],
      state.days.get(dayId)!,
      preferences,
      now,
    )!;
    expect(threshold).toBe(600);
    state = apply(state, [{ type: "player.dismissBreak", dayId, threshold }], now);
    expect(
      nextBreakThreshold(
        entries,
        [...state.workIntervals.values()],
        state.days.get(dayId)!,
        preferences,
        now,
      ),
    ).toBeNull();
    expect(actualWorkSinceBreak(entries, [...state.workIntervals.values()], now)).toBe(600);
    expect(
      nextBreakThreshold(
        entries,
        [...state.workIntervals.values()],
        state.days.get(dayId)!,
        preferences,
        "2026-11-10T01:20:00.000Z",
      ),
    ).toBe(1200);
    state = apply(
      state,
      [
        {
          type: "player.break",
          entryId: taskDayEntryId(dayId, A),
          breakEntryId: "taken-break",
          intervalId: "rest-run",
          deviceId: actor.deviceId,
        },
      ],
      now,
    );
    state = apply(
      state,
      [{ type: "player.finish", entryId: "taken-break" }],
      "2026-11-10T01:11:00.000Z",
    );
    expect(
      actualWorkSinceBreak(
        selectDayEntries(state.dayEntries, dayId, true),
        [...state.workIntervals.values()],
        "2026-11-10T01:11:00.000Z",
      ),
    ).toBe(0);
    expect(state.workIntervals.get("nudge-run")?.endedAt).toBe(now);
    expect(state.tasks.get(A)?.status).toBe("todo");
  });

  it("retains offline overlap warnings after correction and never subtracts double-counted duration", () => {
    const state = play(initial(1), A, "correct-a", "2026-11-10T01:00:00.000Z");
    const entry = state.dayEntries.get(taskDayEntryId(dayId, A))!;
    const first = {
      ...state.workIntervals.get("correct-a")!,
      endedAt: "2026-11-10T01:10:00.000Z",
      correctedSeconds: 0,
    };
    const second = {
      ...first,
      id: "correct-b",
      deviceId: DeviceId.make("device-b"),
      startedAt: "2026-11-10T01:05:00.000Z",
      endedAt: "2026-11-10T01:15:00.000Z",
      correctedSeconds: null,
    };
    expect(deriveEntryTime(entry, [first, second], "2026-11-10T02:00:00.000Z")).toMatchObject({
      actualSeconds: 600,
      overlaps: [["correct-a", "correct-b"]],
    });
  });

  it("Undo restores task/entry state while leaving historical intervals closed and later fields intact", () => {
    let state = play(initial(1), A, "undo-run", "2026-11-10T01:00:00.000Z");
    const before = state.events.length;
    state = apply(
      state,
      [{ type: "task.update", input: { taskId: A, status: "done" } }],
      "2026-11-10T01:10:00.000Z",
    );
    const batch = state.events.slice(before);
    state = apply(
      state,
      [{ type: "task.update", input: { taskId: A, title: "Later title" } }],
      "2026-11-10T01:11:00.000Z",
    );
    const undo = planUndo(batch, state, latestWritesFromEvents(state.events));
    expect(undo.reverts.some((revert) => revert.type === "dayEntry.updated")).toBe(true);
    const commands: BatchCommand[] = [];
    for (const revert of undo.reverts) {
      if (revert.type === "task.updated")
        commands.push({ type: "task.update", input: { taskId: revert.taskId, ...revert.set } });
      if (revert.type === "dayEntry.updated")
        commands.push({ type: "day.update", entryId: revert.entryId, set: revert.set });
    }
    state = apply(state, commands, "2026-11-10T01:12:00.000Z");
    expect(state.tasks.get(A)).toMatchObject({ title: "Later title", status: "todo" });
    expect(state.dayEntries.get(taskDayEntryId(dayId, A))?.status).toBe("pending");
    expect(state.workIntervals.get("undo-run")?.endedAt).toBe("2026-11-10T01:10:00.000Z");
  });

  it("validates context and estimates while old task payloads retain readable defaults", () => {
    let state = apply(emptyFolded(), [
      {
        type: "task.create",
        taskId: A,
        input: { title: "Context", estimateMinutes: 25, place: "Office", mentalMode: "Deep focus" },
      },
    ]);
    expect(state.tasks.get(A)).toMatchObject({
      estimateMinutes: 25,
      place: "Office",
      mentalMode: "Deep focus",
    });
    state = apply(state, [
      { type: "task.update", input: { taskId: A, estimateMinutes: null, place: null } },
    ]);
    expect(state.tasks.get(A)).toMatchObject({
      estimateMinutes: null,
      place: null,
      mentalMode: "Deep focus",
    });
    expect(
      Result.isFailure(
        planBatch(state, [{ type: "task.update", input: { taskId: A, estimateMinutes: -1 } }], {
          actor,
        }),
      ),
    ).toBe(true);
    const old = foldEvents(
      state.events
        .map((event) =>
          event.type === "task.created"
            ? { ...event, estimateMinutes: undefined, place: undefined, mentalMode: undefined }
            : event,
        )
        .slice(0, 1),
    );
    expect(old.tasks.get(A)).toMatchObject({
      estimateMinutes: null,
      place: null,
      mentalMode: null,
    });
  });

  it("canonicalizes initial timestamps so a first chat and its receipt remain ordered", () => {
    const chatId = ChatId.make("c_AAAAAAA1");
    const state = apply(
      emptyFolded(),
      [
        { type: "chat.create", chatId, input: { projectId: null } },
        { type: "chat.message", chatId, messageId: "receipt", role: "system", text: "Saved" },
      ],
      "2026-11-10T01:00:00Z",
    );
    expect(state.chats.get(chatId)?.messages[0]?.id).toBe("receipt");
    expect(state.events.map((event) => event.at)).toEqual([
      "2026-11-10T01:00:00.000Z",
      "2026-11-10T01:00:00.001Z",
    ]);
    const next = apply(state, [{ type: "chat.create", chatId, input: { projectId: null } }]);
    expect(next.events.length).toBe(state.events.length);
    expect(
      Result.isFailure(
        planBatch(
          state,
          [{ type: "chat.create", chatId, input: { projectId: null, title: "Different" } }],
          { actor },
        ),
      ),
    ).toBe(true);
  });
  it("explicitly adding a reopened task gives a fresh allowance without restarting or changing tomorrow", () => {
    let state = play(initial(1), A, "re-add-run", "2026-11-10T01:00:00.000Z");
    state = apply(
      state,
      [{ type: "player.finish", entryId: taskDayEntryId(dayId, A) }],
      "2026-11-10T01:10:00.000Z",
    );
    state = apply(
      state,
      [{ type: "task.update", input: { taskId: A, status: "todo" } }],
      "2026-11-10T01:11:00.000Z",
    );
    expect(state.dayEntries.get(taskDayEntryId(dayId, A))?.status).toBe("done");
    state = apply(
      state,
      [{ type: "day.add", dayId, kind: "task", taskId: A, allocationMinutes: 5 }],
      "2026-11-10T01:12:00.000Z",
    );
    expect(
      deriveEntryTime(
        state.dayEntries.get(taskDayEntryId(dayId, A))!,
        [...state.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 600, remainingSeconds: 300, running: false });
    expect(state.days.has(tomorrowId)).toBe(false);
  });
});

describe("routine and interval correction Undo", () => {
  it("retries an unchanged routine idempotently after decoding and legacy archived defaults", () => {
    const template = { ...ADMIN_TEMPLATE, id: "retry-opening" };
    let state = apply(initial(1), [{ type: "template.save", template }]);
    const count = state.events.length;
    state = apply(state, [{ type: "template.save", template: { ...template, archived: false } }]);
    expect(state.events).toHaveLength(count);
  });

  it("restores the old routine at a fresh version and keeps instantiated days independent", () => {
    const original = { ...ADMIN_TEMPLATE, id: "personal-opening", title: "My opening" };
    let state = apply(initial(1), [{ type: "template.save", template: original }]);
    state = apply(state, [{ type: "day.assemble", dayId, templateId: original.id, append: true }]);
    const oldDaily = selectDayEntries(state.dayEntries, dayId).find(
      (entry) => entry.title === "Mindfulness",
    )!;
    const before = state.events.length;
    state = apply(state, [
      {
        type: "template.save",
        template: {
          ...original,
          version: 2,
          title: "Longer opening",
          items: original.items.map((item) => ({
            ...item,
            allocationMinutes: item.allocationMinutes + 5,
          })),
        },
      },
    ]);
    const batch = state.events.slice(before);
    const undo = planUndo(batch, state, latestWritesFromEvents(state.events));
    const revert = undo.reverts.find((item) => item.type === "stackTemplate.saved");
    expect(revert?.type).toBe("stackTemplate.saved");
    if (revert?.type !== "stackTemplate.saved") return;
    expect(revert.template).toMatchObject({
      id: original.id,
      version: 3,
      title: original.title,
      items: original.items,
      archived: false,
    });
    state = apply(state, [{ type: "template.save", template: revert.template }]);
    expect(state.stackTemplates.get(original.id)).toMatchObject({
      version: 3,
      title: original.title,
      items: original.items,
      archived: false,
    });
    expect(state.dayEntries.get(oldDaily.id)).toEqual(oldDaily);
    expect(state.events.filter((event) => event.type === "stackTemplate.saved")).toHaveLength(3);
  });

  it("archives an undone new routine and rejects using that archived snapshot", () => {
    let state = initial(1);
    const original = { ...ADMIN_TEMPLATE, id: "new-opening" };
    const before = state.events.length;
    state = apply(state, [{ type: "template.save", template: original }]);
    const undo = planUndo(state.events.slice(before), state, latestWritesFromEvents(state.events));
    const revert = undo.reverts.find((item) => item.type === "stackTemplate.saved");
    expect(revert?.type).toBe("stackTemplate.saved");
    if (revert?.type !== "stackTemplate.saved") return;
    state = apply(state, [{ type: "template.save", template: revert.template }]);
    expect(state.stackTemplates.get(original.id)).toMatchObject({ archived: true, version: 2 });
    const result = planBatch(
      state,
      [{ type: "day.assemble", dayId, templateId: original.id, append: true }],
      { actor, now: "2026-11-10T01:00:00.000Z" },
    );
    expect(Result.isFailure(result)).toBe(true);
  });

  it("preserves later routine saves and skips legacy saves without a preimage", () => {
    const original = { ...ADMIN_TEMPLATE, id: "protected-opening" };
    let state = apply(initial(1), [{ type: "template.save", template: original }]);
    const created = state.events.filter((event) => event.type === "stackTemplate.saved");
    state = apply(state, [
      { type: "template.save", template: { ...original, version: 2, title: "Newer choice" } },
    ]);
    const undo = planUndo(created, state, latestWritesFromEvents(state.events));
    expect(undo.reverts).toHaveLength(0);
    expect(undo.skipped).toContainEqual({
      entityId: original.id,
      field: "snapshot",
      reason: "changed_since",
    });
    const legacy = created.map((event) =>
      event.type === "stackTemplate.saved" ? { ...event, prev: undefined } : event,
    );
    const legacyState = foldEvents(legacy);
    const legacyUndo = planUndo(legacy, legacyState, latestWritesFromEvents(legacy));
    expect(legacyUndo.reverts).toHaveLength(0);
    expect(legacyUndo.skipped).toContainEqual({
      entityId: original.id,
      field: "snapshot",
      reason: "missing_preimage",
    });
  });

  it("restores a corrected duration without undoing the interval close or later entry edits", () => {
    let state = play(initial(1), A, "correction-undo", "2026-11-10T01:00:00.000Z");
    const entryId = taskDayEntryId(dayId, A);
    state = apply(state, [{ type: "player.pause", entryId }], "2026-11-10T01:10:00.000Z");
    const closedEnd = state.workIntervals.get("correction-undo")!.endedAt;
    const before = state.events.length;
    state = apply(
      state,
      [{ type: "player.correct", intervalId: "correction-undo", seconds: 120 }],
      "2026-11-10T01:11:00.000Z",
    );
    const corrected = state.events.slice(before);
    state = apply(
      state,
      [{ type: "day.update", entryId, set: { allocationMinutes: 45 } }],
      "2026-11-10T01:12:00.000Z",
    );
    const undo = planUndo(corrected, state, latestWritesFromEvents(state.events));
    const revert = undo.reverts.find((item) => item.type === "workInterval.updated");
    expect(revert).toEqual({
      type: "workInterval.updated",
      intervalId: "correction-undo",
      set: { correctedSeconds: null },
    });
    if (revert?.type !== "workInterval.updated") return;
    state = apply(
      state,
      [
        {
          type: "player.correct",
          intervalId: revert.intervalId,
          seconds: revert.set.correctedSeconds,
        },
      ],
      "2026-11-10T01:13:00.000Z",
    );
    expect(state.workIntervals.get("correction-undo")).toMatchObject({
      endedAt: closedEnd,
      correctedSeconds: null,
    });
    expect(state.dayEntries.get(entryId)?.allocationMinutes).toBe(45);
    expect(
      deriveEntryTime(
        state.dayEntries.get(entryId)!,
        [...state.workIntervals.values()],
        "2026-11-10T02:00:00.000Z",
      ),
    ).toMatchObject({ actualSeconds: 600, running: false });
  });

  it("protects later corrections and supports returning to an earlier explicit duration", () => {
    let state = play(initial(1), A, "correction-protected", "2026-11-10T01:00:00.000Z");
    state = apply(
      state,
      [{ type: "player.pause", entryId: taskDayEntryId(dayId, A) }],
      "2026-11-10T01:10:00.000Z",
    );
    state = apply(state, [
      { type: "player.correct", intervalId: "correction-protected", seconds: 300 },
    ]);
    const before = state.events.length;
    state = apply(state, [
      { type: "player.correct", intervalId: "correction-protected", seconds: 120 },
    ]);
    const batch = state.events.slice(before);
    const revert = planUndo(batch, state, latestWritesFromEvents(state.events)).reverts.find(
      (item) => item.type === "workInterval.updated",
    );
    expect(revert).toEqual({
      type: "workInterval.updated",
      intervalId: "correction-protected",
      set: { correctedSeconds: 300 },
    });
    state = apply(state, [
      { type: "player.correct", intervalId: "correction-protected", seconds: 60 },
    ]);
    const protectedUndo = planUndo(batch, state, latestWritesFromEvents(state.events));
    expect(protectedUndo.reverts).toHaveLength(0);
    expect(protectedUndo.skipped).toContainEqual({
      entityId: "correction-protected",
      field: "correctedSeconds",
      reason: "changed_since",
    });
  });
});
