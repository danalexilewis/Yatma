import { orderKeyBetween } from "./orderKey.ts";
import type { TaskId } from "./ids.ts";
import type { DayEntry, WorkInterval } from "./stackSchemas.ts";
import { deriveEntryTime } from "./stackPlayer.ts";

/** Semantic identity is account-local, independent of the event IDs used to create it. */
export function stackDayId(date: string, _timezone: string): string {
  return JSON.stringify(["day", date]);
}

/** A linked task can have only one entry on a given planning day. */
export function taskDayEntryId(dayId: string, taskId: TaskId): string {
  return JSON.stringify([dayId, "task", taskId]);
}

export function generatedDayEntryId(dayId: string, origin: string): string {
  return JSON.stringify([dayId, "origin", origin]);
}

/** Stable daily ordering never changes the linked task's global priority. */
export function selectDayEntries(
  entries: ReadonlyMap<string, DayEntry> | readonly DayEntry[],
  dayId: string,
  includeHistory = false,
): DayEntry[] {
  const values = Array.isArray(entries)
    ? entries
    : [...(entries as ReadonlyMap<string, DayEntry>).values()];
  return values
    .filter((entry) => entry.dayId === dayId && (includeHistory || entry.status === "pending"))
    .toSorted((a, b) =>
      a.position < b.position
        ? -1
        : a.position > b.position
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
}

export type DayForecast = {
  readonly entryId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly remainingSeconds: number;
};

/** Forecast from remaining allocations; past actuals are retained separately. */
export function forecastDay(
  entries: readonly DayEntry[],
  intervals: readonly WorkInterval[],
  now: string,
): readonly DayForecast[] {
  let cursor = Date.parse(now);
  if (!Number.isFinite(cursor)) return [];
  return entries
    .filter((entry) => entry.status === "pending")
    .map((entry) => {
      const remainingSeconds = deriveEntryTime(entry, intervals, now).remainingSeconds;
      const startsAt = new Date(cursor).toISOString();
      cursor += remainingSeconds * 1000;
      return {
        entryId: entry.id,
        startsAt,
        endsAt: new Date(cursor).toISOString(),
        remainingSeconds,
      };
    });
}

export function plannedWorkMinutes(entries: readonly DayEntry[]): number {
  return entries.reduce(
    (total, entry) =>
      total + (entry.kind !== "break" && entry.status === "pending" ? entry.allocationMinutes : 0),
    0,
  );
}

export function moveEntryToTail<T extends { readonly id: string }>(
  entries: readonly T[],
  id: string,
): readonly T[] {
  const entry = entries.find((item) => item.id === id);
  return entry ? [...entries.filter((item) => item.id !== id), entry] : entries;
}

export function normalizeAllocation(minutes: number): number {
  if (!Number.isFinite(minutes)) throw new RangeError("Allocation must be finite");
  return Math.min(1440, Math.max(1, Math.round(minutes)));
}

/** Fractional placement changes one daily entry and leaves every other row unchanged. */
export function positionBefore(
  entries: readonly DayEntry[],
  beforeEntryId: string | null,
): string | null {
  if (beforeEntryId === null) return orderKeyBetween(entries.at(-1)?.position ?? null, null);
  const index = entries.findIndex((entry) => entry.id === beforeEntryId);
  if (index < 0) return null;
  return orderKeyBetween(entries[index - 1]?.position ?? null, entries[index]!.position);
}
