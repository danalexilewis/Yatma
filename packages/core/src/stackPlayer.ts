import type { TaskId } from "./ids.ts";
import type { DayEntry, WorkInterval } from "./stackSchemas.ts";

export type EntryTime = {
  readonly actualSeconds: number;
  readonly remainingSeconds: number;
  readonly overtimeSeconds: number;
  readonly running: boolean;
  readonly overlaps: readonly (readonly [string, string])[];
  readonly needsClockReview: boolean;
};

/** Derive work from UTC boundaries. Pauses add nothing; overlapping runs are not summed. */
export function deriveEntryTime(
  entry: DayEntry,
  intervals: readonly WorkInterval[],
  now: string,
): EntryTime {
  const own = intervals.filter((interval) => interval.entryId === entry.id);
  const work = deriveWorkTime(own, now);
  const allocationSeconds =
    Number.isFinite(entry.allocationMinutes) && entry.allocationMinutes > 0
      ? entry.allocationMinutes * 60
      : 0;
  return {
    ...work,
    remainingSeconds: Math.max(0, allocationSeconds - work.actualSeconds),
    overtimeSeconds: Math.max(0, work.actualSeconds - allocationSeconds),
    needsClockReview: work.needsClockReview || allocationSeconds === 0,
  };
}

/** Total recorded effort across every occurrence of a task, including previous days and deferrals. */
export function deriveTaskTime(
  taskId: TaskId,
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  now: string,
): Pick<EntryTime, "actualSeconds" | "running" | "overlaps" | "needsClockReview"> {
  const entryIds = new Set(
    entries.filter((entry) => entry.taskId === taskId).map((entry) => entry.id),
  );
  return deriveWorkTime(
    intervals.filter((interval) => entryIds.has(interval.entryId)),
    now,
  );
}

function deriveWorkTime(own: readonly WorkInterval[], now: string) {
  const nowMs = Date.parse(now);
  const ranges: { start: number; end: number; interval: WorkInterval }[] = [];
  let needsClockReview = !Number.isFinite(nowMs);
  for (const interval of own) {
    const start = Date.parse(interval.startedAt);
    const rawEnd = interval.endedAt == null ? nowMs : Date.parse(interval.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd < start) {
      needsClockReview = true;
      continue;
    }
    const corrected = interval.correctedSeconds != null && interval.endedAt != null;
    const validCorrection =
      interval.correctedSeconds == null ||
      (Number.isFinite(interval.correctedSeconds) && interval.correctedSeconds >= 0);
    if (!validCorrection) {
      needsClockReview = true;
      continue;
    }
    if (!corrected && (interval.reviewReason != null || rawEnd - start > 16 * 60 * 60 * 1000))
      needsClockReview = true;
    const effectiveEnd = corrected ? start + interval.correctedSeconds! * 1000 : rawEnd;
    if (!Number.isFinite(effectiveEnd)) {
      needsClockReview = true;
      continue;
    }
    const end = Math.max(start, effectiveEnd);
    ranges.push({ start, end, interval });
  }
  ranges.sort(
    (a, b) =>
      a.start - b.start ||
      (a.interval.id < b.interval.id ? -1 : a.interval.id > b.interval.id ? 1 : 0),
  );
  const overlaps = findIntervalOverlaps(own, now);
  let totalMs = 0;
  let end = -Infinity;
  for (const range of ranges) {
    totalMs += Math.max(0, range.end - Math.max(range.start, end));
    end = Math.max(end, range.end);
  }
  const actualSeconds = Math.max(0, totalMs / 1000);
  return {
    actualSeconds,
    running: own.some((interval) => interval.endedAt == null),
    overlaps,
    needsClockReview,
  };
}

/** Find offline overlap across different entries as well as copies of one entry. */
export function findIntervalOverlaps(
  intervals: readonly WorkInterval[],
  now: string,
): readonly (readonly [string, string])[] {
  const result: [string, string][] = [];
  const ranges = intervals.flatMap((interval) => {
    const start = Date.parse(interval.startedAt);
    const end = Date.parse(interval.endedAt ?? now);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? [{ interval, start, end }]
      : [];
  });
  for (let i = 0; i < ranges.length; i += 1) {
    const left = ranges[i]!;
    for (let j = i + 1; j < ranges.length; j += 1) {
      const right = ranges[j]!;
      if (left.interval.deviceId === right.interval.deviceId) continue;
      if (left.start < right.end && right.start < left.end)
        result.push([left.interval.id, right.interval.id]);
    }
  }
  return result;
}
