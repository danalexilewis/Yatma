import {
  TaskId,
  DeviceId,
  emptyFolded,
  foldEvents,
  parseEventLine,
  selectDayEntries,
  stackDayId,
  type BatchCommand,
} from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { dayMoveFromDrop } from "../features/today/reorder";
import { createDailyStack, localPlanningDay } from "./dailyStack";
import { createLocalMutationWriter, localUserActor } from "./mutations";

function harness() {
  let folded = emptyFolded();
  let failCommit = false;
  const actor = localUserActor("device-daily");
  const writer = createLocalMutationWriter({
    readSnapshot: async () => ({ folded, deviceId: "device-daily", lastSeenAt: null }),
    commitBatch: async (events) => {
      if (failCommit) throw new Error("storage unavailable");
      folded = foldEvents([...folded.events, ...events]);
      return folded;
    },
    publish: (next) => {
      folded = next;
    },
    sessionGeneration: () => 0,
    now: () => "2026-11-10T00:00:00.000Z",
  });
  function execute(commands: readonly BatchCommand[]) {
    return writer.execute(commands, actor);
  }
  return {
    daily: createDailyStack(execute),
    execute,
    get folded() {
      return folded;
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
  };
}

describe("daily application commands", () => {
  it("opens the routine without silently committing the backlog to Today", async () => {
    const h = harness();
    const taskId = TaskId.make("t_ABCDEFGH");
    await h.execute([
      { type: "task.create", taskId, input: { title: "Discuss before committing" } },
    ]);
    const dayId = await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    expect([...h.folded.dayEntries.values()].some((entry) => entry.taskId === taskId)).toBe(false);
    expect(h.folded.days.get(dayId)?.assembled).toBe(true);
    await h.daily.scheduleTask(taskId, "2026-11-10", "2026-11-10", "Pacific/Auckland");
    await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    expect(
      [...h.folded.dayEntries.values()].filter(
        (entry) => entry.taskId === taskId && entry.status === "pending",
      ),
    ).toHaveLength(1);
  });
  it("assembles once and preserves the person's daily edits on reopening", async () => {
    const h = harness();
    const dayId = await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    expect(dayId).toBe(stackDayId("2026-11-10", "Pacific/Auckland"));
    const entries = [...h.folded.dayEntries.values()];
    expect(entries.map((entry) => entry.allocationMinutes)).toEqual([10, 5, 30]);
    const selected = entries[0]!;
    await h.execute([
      { type: "day.update", entryId: selected.id, set: { allocationMinutes: 15, manual: true } },
    ]);
    const eventCount = h.folded.events.length;
    await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    expect(h.folded.days.size).toBe(1);
    expect(h.folded.dayEntries.size).toBe(3);
    expect(h.folded.dayEntries.get(selected.id)?.allocationMinutes).toBe(15);
    expect(h.folded.events).toHaveLength(eventCount);
  });

  it("adds a task without modifying its global priority or due date", async () => {
    const h = harness();
    const taskId = TaskId.make("t_ABCDEFGH");
    await h.execute([
      {
        type: "task.create",
        taskId,
        input: { title: "Keep global fields", dueDate: "2026-11-12" },
      },
    ]);
    const task = h.folded.tasks.get(taskId)!;
    await h.daily.scheduleTask(taskId, "2026-11-10", "2026-11-10", "Pacific/Auckland");
    const dayId = stackDayId("2026-11-10", "Pacific/Auckland");
    await h.daily.scheduleTask(taskId, "2026-11-10", "2026-11-10", "Pacific/Auckland");
    expect(h.folded.tasks.get(taskId)).toMatchObject({
      position: task.position,
      dueDate: task.dueDate,
      scheduledDate: "2026-11-10",
    });
    expect(
      [...h.folded.dayEntries.values()].filter(
        (entry) => entry.dayId === dayId && entry.taskId === taskId,
      ),
    ).toHaveLength(1);
  });

  it.each([
    [2, 0],
    [0, 2],
    [0, 1],
    [2, 1],
  ])(
    "persists a Today drop from %i to %i across journal reload without changing tasks",
    async (from, to) => {
      const h = harness();
      const dayId = await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
      const data = [...selectDayEntries(h.folded.dayEntries, dayId)];
      const [moved] = data.splice(from, 1);
      data.splice(to, 0, moved!);
      const beforeTasks = [...h.folded.tasks];
      const command = dayMoveFromDrop(data, from, to)!;
      await h.execute([command]);
      const reloaded = foldEvents(
        h.folded.events.map((event) => {
          const result = parseEventLine(JSON.stringify(event));
          if (!result.ok) throw new Error("Invalid journal event");
          return result.event;
        }),
      );
      expect(selectDayEntries(reloaded.dayEntries, dayId).map((entry) => entry.id)).toEqual(
        data.map((entry) => entry.id),
      );
      expect([...reloaded.tasks]).toEqual(beforeTasks);
    },
  );

  it("retains committed order on failed drops and allows retry", async () => {
    const h = harness();
    const dayId = await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    const entries = selectDayEntries(h.folded.dayEntries, dayId);
    const data = [entries[2]!, entries[0]!, entries[1]!];
    const command = dayMoveFromDrop(data, 2, 0)!;
    expect(dayMoveFromDrop(entries, 0, 0)).toBeNull();
    expect(dayMoveFromDrop(entries, -1, 0)).toBeNull();
    expect(dayMoveFromDrop(entries, 0, entries.length)).toBeNull();
    h.failCommit = true;
    await expect(h.execute([command])).rejects.toThrow("Local changes could not be saved");
    expect(selectDayEntries(h.folded.dayEntries, dayId)).toEqual(entries);
    h.failCommit = false;
    await h.execute([command]);
    expect(selectDayEntries(h.folded.dayEntries, dayId).map((entry) => entry.id)).toEqual(
      data.map((entry) => entry.id),
    );
  });

  it("does not report successful assembly if the shared writer rejects the batch", async () => {
    const h = harness();
    h.failCommit = true;
    await expect(h.daily.ensureToday("2026-11-10", "Pacific/Auckland")).rejects.toThrow(
      "Local changes could not be saved",
    );
    expect(h.folded.days.size).toBe(0);
    expect(h.folded.dayEntries.size).toBe(0);
    expect(h.folded.events).toEqual([]);
    h.failCommit = false;
    await h.daily.ensureToday("2026-11-10", "Pacific/Auckland");
    expect(h.folded.days.size).toBe(1);
    expect(h.folded.dayEntries.size).toBe(3);
  });
});

describe("planning timezone calendar date", () => {
  it("uses the local calendar day on each side of midnight, independent of UTC date", () => {
    expect(localPlanningDay(new Date("2026-11-10T10:59:59.000Z"), "Pacific/Auckland")).toBe(
      "2026-11-10",
    );
    expect(localPlanningDay(new Date("2026-11-10T11:00:00.000Z"), "Pacific/Auckland")).toBe(
      "2026-11-11",
    );
    expect(localPlanningDay(new Date("2026-11-10T01:00:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-11-09",
    );
  });

  it("keeps the date stable across daylight-saving skipped and repeated clock hours", () => {
    expect(localPlanningDay(new Date("2026-03-08T09:59:59.000Z"), "America/Los_Angeles")).toBe(
      "2026-03-08",
    );
    expect(localPlanningDay(new Date("2026-03-08T10:00:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-03-08",
    );
    expect(localPlanningDay(new Date("2026-11-01T08:59:59.000Z"), "America/Los_Angeles")).toBe(
      "2026-11-01",
    );
    expect(localPlanningDay(new Date("2026-11-01T09:00:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-11-01",
    );
  });
});

it("unschedules atomically, stops active work without deleting it, and can add again", async () => {
  const h = harness();
  const taskId = TaskId.make("t_SCHED001");
  const date = "2026-11-10";
  const timezone = "Pacific/Auckland";
  await h.execute([
    { type: "task.create", taskId, input: { title: "Tax", dueDate: "2026-12-31" } },
  ]);
  await h.daily.scheduleTask(taskId, "2026-11-10", date, timezone);
  const dayId = stackDayId(date, timezone);
  const entry = selectDayEntries(h.folded.dayEntries, dayId)[0]!;
  await h.execute([
    {
      type: "player.play",
      entryId: entry.id,
      intervalId: "interval-schedule",
      deviceId: DeviceId.make("device-daily"),
    },
  ]);
  await h.daily.scheduleTask(taskId, null, date, timezone);
  expect(h.folded.tasks.get(taskId)).toMatchObject({ scheduledDate: null, dueDate: "2026-12-31" });
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toHaveLength(0);
  expect(h.folded.workIntervals.get("interval-schedule")?.endedAt).not.toBeNull();
  expect(h.folded.workIntervals.size).toBe(1);
  const replay = foldEvents(h.folded.events);
  expect(replay.tasks.get(taskId)?.scheduledDate).toBeNull();
  expect(replay.dayEntries.get(entry.id)?.status).toBe("removed");
  await h.daily.scheduleTask(taskId, "2026-11-10", date, timezone);
  expect(h.folded.tasks.get(taskId)?.scheduledDate).toBe(date);
  expect(
    selectDayEntries(h.folded.dayEntries, dayId).filter((item) => item.taskId === taskId),
  ).toHaveLength(1);
});

it("does not partially add or unschedule when storage fails", async () => {
  const h = harness();
  const taskId = TaskId.make("t_SCHED002");
  const date = "2026-11-10";
  const timezone = "Pacific/Auckland";
  await h.execute([
    { type: "task.create", taskId, input: { title: "Keep my plan", scheduledDate: "2026-11-20" } },
  ]);
  h.failCommit = true;
  await expect(h.daily.scheduleTask(taskId, "2026-11-10", date, timezone)).rejects.toThrow();
  expect(h.folded.tasks.get(taskId)?.scheduledDate).toBe("2026-11-20");
  expect(h.folded.dayEntries.size).toBe(0);
  h.failCommit = false;
  await h.daily.scheduleTask(taskId, "2026-11-10", date, timezone);
  const dayId = stackDayId(date, timezone);
  h.failCommit = true;
  await expect(h.daily.scheduleTask(taskId, null, date, timezone)).rejects.toThrow();
  expect(h.folded.tasks.get(taskId)?.scheduledDate).toBe(date);
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toHaveLength(1);
  h.failCommit = false;
  await h.daily.scheduleTask(taskId, "2026-11-20", date, timezone);
  expect(h.folded.tasks.get(taskId)?.scheduledDate).toBe("2026-11-20");
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toHaveLength(0);
});

it("derives Today membership from schedule edits and loads already-scheduled tasks on opening a day", async () => {
  const h = harness();
  const taskId = TaskId.make("t_SCHED003");
  const date = "2026-11-10";
  const timezone = "Pacific/Auckland";
  await h.execute([
    {
      type: "task.create",
      taskId,
      input: { title: "Scheduled first", scheduledDate: date, dueDate: "2026-12-31" },
    },
  ]);
  const dayId = await h.daily.ensureToday(date, timezone, false);
  const entry = selectDayEntries(h.folded.dayEntries, dayId)[0]!;
  expect(entry.taskId).toBe(taskId);
  await h.execute([{ type: "day.update", entryId: entry.id, set: { allocationMinutes: 45 } }]);
  await h.execute([{ type: "task.update", input: { taskId, scheduledDate: null } }]);
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toHaveLength(0);
  await h.execute([{ type: "task.update", input: { taskId, scheduledDate: date } }]);
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toMatchObject([
    { id: entry.id, allocationMinutes: 45 },
  ]);
  await h.execute([{ type: "day.remove", entryId: entry.id }]);
  expect(h.folded.tasks.get(taskId)).toMatchObject({ scheduledDate: null, dueDate: "2026-12-31" });
  await h.daily.ensureToday(date, timezone, false);
  expect(selectDayEntries(h.folded.dayEntries, dayId)).toHaveLength(0);
});
