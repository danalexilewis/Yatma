import { generateSpreadOrderKeys, orderKeyBetween } from "./orderKey.ts";
import type {
  Day,
  DayEntry,
  StackPreferences,
  StackTemplate,
  WorkInterval,
} from "./stackSchemas.ts";
import { generatedDayEntryId, taskDayEntryId } from "./dailyStack.ts";
import { deriveEntryTime } from "./stackPlayer.ts";

/** Materialize independent daily entries. Template edits cannot rewrite an instantiated day. */
export function instantiateTemplate(
  template: StackTemplate,
  dayId: string,
  now: string,
): readonly DayEntry[] {
  const keys = generateSpreadOrderKeys(template.items.length);
  return template.items.map((item, index) => {
    const origin = `template:${template.id}:${template.version}:${item.key}`;
    return {
      id: item.taskId ? taskDayEntryId(dayId, item.taskId) : generatedDayEntryId(dayId, origin),
      dayId,
      kind: item.taskId ? "task" : item.kind,
      taskId: item.taskId ?? null,
      title: item.title,
      allocationMinutes: item.allocationMinutes,
      position: `${item.preparation ? "b" : "m"}${keys[index]}`,
      status: "pending",
      origin,
      manual: false,
      carryOrder: null,
      preparation: item.preparation ?? false,
      resumeEntryId: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export type BreakReconciliation = {
  readonly create: readonly DayEntry[];
  readonly revive: readonly string[];
  readonly remove: readonly string[];
  readonly update: readonly {
    readonly entryId: string;
    readonly set: { readonly position: string; readonly allocationMinutes: number };
  }[];
};

/** Reconcile only untouched future breaks; manual, running and completed history survives. */
export function reconcileAutomaticBreaks(
  day: Day,
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  preferences: StackPreferences,
  now: string,
): BreakReconciliation {
  const create: DayEntry[] = [];
  const revive: string[] = [];
  const needed = new Set<string>();
  const update: { entryId: string; set: { position: string; allocationMinutes: number } }[] = [];
  const work = entries.filter((entry) => entry.status === "pending" && entry.kind !== "break");
  let workMinutes = 0;
  for (let index = 0; index < work.length - 1; index += 1) {
    const entry = work[index]!;
    const remaining = deriveEntryTime(entry, intervals, now).remainingSeconds / 60;
    workMinutes += remaining;
    const next = work[index + 1]!;
    const manualBetween = entries.some(
      (item) =>
        item.status === "pending" &&
        item.kind === "break" &&
        item.manual &&
        item.position > entry.position &&
        item.position < next.position,
    );
    if (manualBetween) {
      workMinutes = 0;
      continue;
    }
    if (!preferences.automaticBreaks || workMinutes < preferences.workIntervalMinutes) continue;
    const origin = `auto-break:${entry.id}`;
    needed.add(origin);
    const between = entries.filter(
      (item) =>
        item.status === "pending" &&
        item.kind === "break" &&
        item.position > entry.position &&
        item.position < next.position,
    );
    const existingBetween = between.find((item) => item.origin === origin);
    if (existingBetween) {
      if (
        !existingBetween.manual &&
        !intervals.some((interval) => interval.entryId === existingBetween.id) &&
        existingBetween.allocationMinutes !== preferences.breakMinutes
      )
        update.push({
          entryId: existingBetween.id,
          set: { position: existingBetween.position, allocationMinutes: preferences.breakMinutes },
        });
      workMinutes = 0;
      continue;
    }
    if (
      between.some(
        (item) => item.manual || intervals.some((interval) => interval.entryId === item.id),
      )
    ) {
      workMinutes = 0;
      continue;
    }
    if (!day.suppressedBreakOrigins.includes(origin)) {
      const id = generatedDayEntryId(day.id, origin);
      const existing = entries.find((item) => item.id === id);
      if (!existing) {
        const position = orderKeyBetween(entry.position, next.position);
        if (position)
          create.push({
            id,
            dayId: day.id,
            kind: "break",
            taskId: null,
            title: "Break",
            allocationMinutes: preferences.breakMinutes,
            position,
            status: "pending",
            origin,
            manual: false,
            carryOrder: null,
            preparation: false,
            resumeEntryId: null,
            createdAt: now,
            updatedAt: now,
          });
      } else if (
        !existing.manual &&
        !intervals.some((interval) => interval.entryId === existing.id)
      ) {
        const position = orderKeyBetween(entry.position, next.position);
        if (existing.status === "removed") revive.push(existing.id);
        if (
          position &&
          (position !== existing.position ||
            existing.allocationMinutes !== preferences.breakMinutes)
        )
          update.push({
            entryId: existing.id,
            set: { position, allocationMinutes: preferences.breakMinutes },
          });
      }
    }
    workMinutes = 0;
  }
  const remove = entries
    .filter(
      (entry) =>
        entry.kind === "break" &&
        entry.origin.startsWith("auto-break:") &&
        !entry.manual &&
        entry.status === "pending" &&
        !needed.has(entry.origin) &&
        !intervals.some((interval) => interval.entryId === entry.id),
    )
    .map((entry) => entry.id);
  return { create, revive, remove, update };
}

/** Completed qualifying breaks reset actual work; skipping or dismissing never invents rest. */
export function actualWorkSinceBreak(
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  now: string,
): number {
  let lastRest = -Infinity;
  for (const entry of entries) {
    if (entry.kind !== "break" || entry.status !== "done") continue;
    const own = intervals.filter((interval) => interval.entryId === entry.id);
    if (deriveEntryTime(entry, own, now).actualSeconds < entry.allocationMinutes * 60) continue;
    for (const interval of own)
      if (interval.endedAt != null) lastRest = Math.max(lastRest, Date.parse(interval.endedAt));
  }
  return workSeconds(entries, intervals, now, lastRest);
}

function workSeconds(
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  now: string,
  after: number,
): number {
  const ranges: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const entry = entries.find((item) => item.id === interval.entryId);
    if (!entry || entry.kind === "break") continue;
    const start = Math.max(after, Date.parse(interval.startedAt));
    const end =
      interval.endedAt != null && interval.correctedSeconds != null
        ? Date.parse(interval.startedAt) + interval.correctedSeconds * 1000
        : Date.parse(interval.endedAt ?? now);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  let end = -Infinity;
  let seconds = 0;
  for (const range of ranges) {
    seconds += Math.max(0, range.end - Math.max(end, range.start)) / 1000;
    end = Math.max(end, range.end);
  }
  return seconds;
}

/** Persist the returned threshold when dismissed; a later threshold can be offered again. */
export function nextBreakThreshold(
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  day: Day,
  preferences: StackPreferences,
  now: string,
): number | null {
  if (!preferences.automaticBreaks) return null;
  const period = preferences.workIntervalMinutes * 60;
  if (actualWorkSinceBreak(entries, intervals, now) < period) return null;
  const threshold = Math.floor(workSeconds(entries, intervals, now, -Infinity) / period) * period;
  return (day.dismissedBreakThresholds ?? []).includes(threshold) ? null : threshold;
}
