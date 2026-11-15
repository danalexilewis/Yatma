import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { planBatch } from "./batch.ts";
import { Event as EventSchema } from "./events.ts";
import { emptyFolded } from "./fold.ts";
import { ChatId, DeviceId, EventId } from "./ids.ts";
import { IsoDateTime } from "./schemas.ts";
import { forecastDay } from "./dailyStack.ts";
import { applyStackEvent, copyStackMaps } from "./stackFold.ts";
import { deriveEntryTime, findIntervalOverlaps } from "./stackPlayer.ts";
import {
  ADMIN_TEMPLATE,
  Day,
  DayEntry,
  StackPreferences,
  StackTemplate,
  StackTimestamp,
  WorkInterval,
  defaultStackPreferences,
} from "./stackSchemas.ts";

const now = "2026-11-10T01:10:00.000Z";
const actor = { kind: "user" as const, deviceId: DeviceId.make("device-a") };
const day: Day = {
  id: "day",
  date: "2026-11-10",
  timezone: "Pacific/Auckland",
  assembled: true,
  suppressedBreakOrigins: [],
  createdAt: now,
  updatedAt: now,
};
const entry: DayEntry = {
  id: "entry",
  dayId: day.id,
  kind: "activity",
  taskId: null,
  title: "Work",
  allocationMinutes: 30,
  position: "n",
  status: "pending",
  origin: "manual:entry",
  manual: true,
  carryOrder: null,
  preparation: false,
  resumeEntryId: null,
  createdAt: now,
  updatedAt: now,
};
const interval: WorkInterval = {
  id: "run",
  entryId: entry.id,
  dayId: day.id,
  deviceId: actor.deviceId,
  startedAt: "2026-11-10T01:00:00.000Z",
  endedAt: now,
  correctedSeconds: null,
  updatedAt: now,
};
const envelope = {
  v: 1 as const,
  id: EventId.make("00000000000000000000000001"),
  at: now,
  by: actor,
};

describe("daily record validation and legacy clock recovery", () => {
  it("accepts explicit ISO instants and rejects unparseable, rolled-over or unzoned boundaries", () => {
    const isTimestamp = Schema.is(StackTimestamp);
    expect(isTimestamp(now)).toBe(true);
    expect(isTimestamp("2026-11-10T14:10:00+13:00")).toBe(true);
    for (const invalid of [
      "not a date",
      "Infinity",
      "2026-02-30T01:00:00.000Z",
      "2026-11-10T25:00:00.000Z",
      "2026-11-10T01:70:00.000Z",
      "2026-11-10T01:00:00",
      "2026-11-10",
      "2026-11-10T01:00:00+99:00",
    ])
      expect(isTimestamp(invalid)).toBe(false);
    // v1 reader compatibility is deliberately retained.
    expect(Schema.is(IsoDateTime)("legacy imported timestamp")).toBe(true);
  });

  it("rejects invalid timestamps on every new projection and event interval boundary", () => {
    expect(Schema.is(Day)({ ...day, createdAt: "bad" })).toBe(false);
    expect(Schema.is(DayEntry)({ ...entry, updatedAt: "bad" })).toBe(false);
    expect(Schema.is(WorkInterval)({ ...interval, startedAt: "bad" })).toBe(false);
    expect(Schema.is(WorkInterval)({ ...interval, endedAt: "bad" })).toBe(false);
    expect(Schema.is(WorkInterval)({ ...interval, updatedAt: "bad" })).toBe(false);
    expect(Schema.is(StackTemplate)({ ...ADMIN_TEMPLATE, updatedAt: "bad" })).toBe(false);
    expect(Schema.is(StackPreferences)({ ...defaultStackPreferences, updatedAt: "bad" })).toBe(
      false,
    );
    expect(
      Schema.is(EventSchema)({
        ...envelope,
        type: "workInterval.created",
        interval: { ...interval, startedAt: "bad" },
      }),
    ).toBe(false);
    expect(
      Schema.is(EventSchema)({
        ...envelope,
        type: "workInterval.updated",
        intervalId: interval.id,
        set: { endedAt: "bad" },
      }),
    ).toBe(false);
    expect(
      Schema.is(EventSchema)({
        ...envelope,
        at: "bad",
        type: "stackPreferences.updated",
        set: { scene: "rain" },
      }),
    ).toBe(false);
    expect(
      Schema.is(EventSchema)({
        ...envelope,
        at: "legacy imported timestamp",
        type: "chat.created",
        chatId: ChatId.make("c_AAAAAAA1"),
        projectId: null,
      }),
    ).toBe(true);
  });

  it("rejects negative-duration records and retains zero-time clock-review closures", () => {
    expect(Schema.is(WorkInterval)({ ...interval, endedAt: "2026-11-10T00:59:00.000Z" })).toBe(
      false,
    );
    const closed = {
      ...interval,
      endedAt: interval.startedAt,
      reviewReason: "clock_discontinuity" as const,
    };
    expect(Schema.is(WorkInterval)(closed)).toBe(true);
    expect(deriveEntryTime(entry, [closed], now)).toMatchObject({
      actualSeconds: 0,
      running: false,
      needsClockReview: true,
    });
    expect(deriveEntryTime(entry, [{ ...closed, correctedSeconds: 0 }], now).needsClockReview).toBe(
      false,
    );
    const maps = copyStackMaps({
      workIntervals: new Map([[interval.id, { ...interval, endedAt: null }]]),
    });
    applyStackEvent(maps, {
      ...envelope,
      type: "workInterval.updated",
      intervalId: interval.id,
      set: { endedAt: "2026-11-10T00:59:00.000Z" },
    });
    expect(maps.workIntervals.get(interval.id)).toMatchObject({
      endedAt: interval.startedAt,
      reviewReason: "clock_discontinuity",
    });
    expect(Schema.is(WorkInterval)(maps.workIntervals.get(interval.id))).toBe(true);
  });

  it("returns typed invalid_command for invalid new or hydrated planning timezones", () => {
    expect(Schema.is(Day)({ ...day, timezone: "Not/A_Timezone" })).toBe(false);
    const invalidEnsure = planBatch(
      emptyFolded(),
      [{ type: "day.ensure", date: day.date, timezone: "Not/A_Timezone" }],
      { actor, now },
    );
    expect(Result.isFailure(invalidEnsure) && invalidEnsure.failure.code).toBe("invalid_command");
    const snapshot = {
      ...emptyFolded(),
      days: new Map([[day.id, { ...day, timezone: "Not/A_Timezone" }]]),
    };
    const invalidHydrate = planBatch(
      snapshot,
      [{ type: "preferences.update", set: { automaticBreaks: false } }],
      { actor, now },
    );
    expect(Result.isFailure(invalidHydrate) && invalidHydrate.failure.code).toBe("invalid_command");
  });

  it("skips malformed legacy ranges, preserves valid overlap evidence and keeps forecast finite", () => {
    const remote = {
      ...interval,
      id: "remote",
      deviceId: DeviceId.make("device-b"),
      startedAt: "2026-11-10T01:05:00.000Z",
    };
    const invalid = [
      { ...interval, id: "bad-start", startedAt: "unparseable" },
      { ...interval, id: "bad-end", endedAt: "unparseable" },
      { ...interval, id: "backwards", endedAt: "2026-11-10T00:00:00.000Z" },
      { ...interval, id: "bad-correction", correctedSeconds: Infinity },
      { ...interval, id: "negative-correction", correctedSeconds: -10 },
    ];
    const derived = deriveEntryTime(entry, [...invalid, interval, remote], now);
    expect(derived).toMatchObject({
      actualSeconds: 600,
      remainingSeconds: 1200,
      needsClockReview: true,
    });
    // Corrections do not hide the original overlapping UTC ranges while review is pending.
    expect(derived.overlaps).toContainEqual(["run", "remote"]);
    expect(
      derived.overlaps.some(([left]) => ["bad-start", "bad-end", "backwards"].includes(left)),
    ).toBe(false);
    expect(Number.isFinite(derived.actualSeconds)).toBe(true);
    const forecast = forecastDay([entry], [...invalid, interval, remote], now);
    expect(forecast[0]).toMatchObject({
      startsAt: now,
      endsAt: "2026-11-10T01:30:00.000Z",
      remainingSeconds: 1200,
    });
    expect(forecastDay([entry], invalid, "invalid-now")).toEqual([]);
    expect(findIntervalOverlaps(invalid, now)).toEqual([]);
  });
  it("compares offset ISO boundaries chronologically when closing a known run", () => {
    const offsetInterval = { ...interval, startedAt: "2026-11-10T14:00:00+13:00", endedAt: null };
    const state = {
      ...emptyFolded(),
      days: new Map([[day.id, day]]),
      dayEntries: new Map([[entry.id, entry]]),
      workIntervals: new Map([[interval.id, offsetInterval]]),
    };
    const result = planBatch(state, [{ type: "player.pause", entryId: entry.id }], { actor, now });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    const close = result.success.drafts.find((draft) => draft.type === "workInterval.updated");
    expect(close?.type === "workInterval.updated" && close.set.endedAt).toBe(now);
    const maps = copyStackMaps({
      workIntervals: new Map([
        [interval.id, { ...offsetInterval, endedAt: "2026-11-10T14:20:00+13:00" }],
      ]),
    });
    applyStackEvent(maps, {
      ...envelope,
      type: "workInterval.updated",
      intervalId: interval.id,
      set: { endedAt: now },
    });
    expect(maps.workIntervals.get(interval.id)?.endedAt).toBe(now);
  });
});
