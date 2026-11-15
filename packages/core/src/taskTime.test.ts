import { describe, expect, it } from "vite-plus/test";

import { DeviceId, TaskId } from "./ids.ts";
import { deriveTaskTime } from "./stackPlayer.ts";
import type { DayEntry, WorkInterval } from "./stackSchemas.ts";

const taskId = TaskId.make("t_AAAAAAA1");
const now = "2026-11-11T01:10:00.000Z";
function entry(id: string, dayId: string, status: DayEntry["status"] = "pending"): DayEntry {
  return {
    id,
    dayId,
    taskId,
    status,
    kind: "task",
    title: "Work",
    allocationMinutes: 30,
    position: "n",
    origin: `manual:${id}`,
    manual: true,
    carryOrder: null,
    preparation: false,
    resumeEntryId: null,
    createdAt: now,
    updatedAt: now,
  };
}
function interval(
  id: string,
  item: DayEntry,
  startedAt: string,
  endedAt: string | null,
): WorkInterval {
  return {
    id,
    entryId: item.id,
    dayId: item.dayId,
    deviceId: DeviceId.make(id),
    startedAt,
    endedAt,
    correctedSeconds: null,
    updatedAt: now,
  };
}

describe("task lifetime effort", () => {
  it("includes prior deferred entries, corrected effort and a live run, excluding other tasks", () => {
    const yesterday = entry("old", "yesterday", "deferred");
    const today = entry("new", "today");
    const other = { ...entry("other", "today"), taskId: TaskId.make("t_BBBBBBB2") };
    const result = deriveTaskTime(
      taskId,
      [yesterday, today, other],
      [
        {
          ...interval("old-run", yesterday, "2026-11-10T01:00:00.000Z", "2026-11-10T01:30:00.000Z"),
          correctedSeconds: 300,
        },
        interval("live", today, "2026-11-11T01:00:00.000Z", null),
        interval("other-run", other, "2026-11-11T00:00:00.000Z", now),
      ],
      now,
    );
    expect(result).toMatchObject({ actualSeconds: 900, running: true, needsClockReview: false });
  });

  it("unions overlapping offline intervals even across occurrences of the same task", () => {
    const first = entry("first", "day");
    const second = entry("second", "day");
    const result = deriveTaskTime(
      taskId,
      [first, second],
      [
        interval("a", first, "2026-11-11T01:00:00.000Z", now),
        interval("b", second, "2026-11-11T01:05:00.000Z", "2026-11-11T01:15:00.000Z"),
      ],
      now,
    );
    expect(result.actualSeconds).toBe(900);
    expect(result.overlaps).toEqual([["a", "b"]]);
  });

  it("reports no effort for an unworked task and ignores invalid intervals", () => {
    const item = entry("item", "today");
    expect(deriveTaskTime(taskId, [item], [], now).actualSeconds).toBe(0);
    expect(
      deriveTaskTime(taskId, [item], [interval("bad", item, "invalid", now)], now),
    ).toMatchObject({ actualSeconds: 0, needsClockReview: true });
  });
});
