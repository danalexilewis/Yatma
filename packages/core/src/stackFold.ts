import type { Event } from "./events.ts";
import type {
  Day,
  DayEntry,
  WorkInterval,
  StackTemplate,
  StackPreferences,
} from "./stackSchemas.ts";
import { defaultStackPreferences } from "./stackSchemas.ts";

function mergeDefined<T extends object>(current: T, set: object): T {
  const next = { ...current };
  for (const [key, value] of Object.entries(set))
    if (value !== undefined) Reflect.set(next, key, value);
  return next;
}

export type StackMaps = {
  readonly days: Map<string, Day>;
  readonly dayEntries: Map<string, DayEntry>;
  readonly workIntervals: Map<string, WorkInterval>;
  readonly stackTemplates: Map<string, StackTemplate>;
  readonly stackPreferences: Map<string, StackPreferences>;
};

/** Creates independent mutable projections; old snapshots may contain no daily data. */
export function copyStackMaps(
  state: {
    readonly days?: ReadonlyMap<string, Day>;
    readonly dayEntries?: ReadonlyMap<string, DayEntry>;
    readonly workIntervals?: ReadonlyMap<string, WorkInterval>;
    readonly stackTemplates?: ReadonlyMap<string, StackTemplate>;
    readonly stackPreferences?: ReadonlyMap<string, StackPreferences>;
  } = {},
): StackMaps {
  return {
    days: new Map(state.days),
    dayEntries: new Map(state.dayEntries),
    workIntervals: new Map(state.workIntervals),
    stackTemplates: new Map(state.stackTemplates),
    stackPreferences: new Map(state.stackPreferences),
  };
}

/** Apply ordered events. Creates are semantic first-writes; edits are per-field LWW. */
export function applyStackEvent(state: StackMaps, event: Event): void {
  switch (event.type) {
    case "day.created":
      if (!state.days.has(event.day.id))
        state.days.set(event.day.id, { ...event.day, createdAt: event.at, updatedAt: event.at });
      break;
    case "day.updated": {
      const day = state.days.get(event.dayId);
      if (day)
        state.days.set(day.id, {
          ...mergeDefined(day, event.set),
          suppressedBreakOrigins: [
            ...new Set([
              ...day.suppressedBreakOrigins,
              ...(event.set.suppressedBreakOrigins ?? []),
            ]),
          ],
          dismissedBreakThresholds: [
            ...new Set([
              ...(day.dismissedBreakThresholds ?? []),
              ...(event.set.dismissedBreakThresholds ?? []),
            ]),
          ],
          updatedAt: event.at,
        });
      break;
    }
    case "dayEntry.created":
      if (!state.dayEntries.has(event.entry.id))
        state.dayEntries.set(event.entry.id, {
          ...event.entry,
          createdAt: event.at,
          updatedAt: event.at,
        });
      break;
    case "dayEntry.updated": {
      const entry = state.dayEntries.get(event.entryId);
      if (entry)
        state.dayEntries.set(entry.id, { ...mergeDefined(entry, event.set), updatedAt: event.at });
      break;
    }
    case "workInterval.created":
      if (!state.workIntervals.has(event.interval.id))
        state.workIntervals.set(event.interval.id, { ...event.interval, updatedAt: event.at });
      break;
    case "workInterval.updated": {
      const interval = state.workIntervals.get(event.intervalId);
      if (interval) {
        // A normal close can only make an interval shorter; reopening is never implicit Undo.
        const end = event.set.endedAt;
        const endedAt =
          end == null
            ? interval.endedAt
            : interval.endedAt == null
              ? end
              : Date.parse(end) < Date.parse(interval.endedAt)
                ? end
                : interval.endedAt;
        const backwards = endedAt !== null && Date.parse(endedAt) < Date.parse(interval.startedAt);
        state.workIntervals.set(interval.id, {
          ...mergeDefined(interval, event.set),
          endedAt: backwards ? interval.startedAt : endedAt,
          ...(backwards ? { reviewReason: "clock_discontinuity" as const } : {}),
          updatedAt: event.at,
        });
      }
      break;
    }
    case "stackTemplate.saved": {
      const existing = state.stackTemplates.get(event.template.id);
      if (!existing || event.template.version >= existing.version)
        state.stackTemplates.set(event.template.id, {
          ...event.template,
          archived: event.template.archived ?? false,
          updatedAt: event.at,
        });
      break;
    }
    case "stackPreferences.updated":
      state.stackPreferences.set("default", {
        ...mergeDefined(
          state.stackPreferences.get("default") ?? defaultStackPreferences,
          event.set,
        ),
        updatedAt: event.at,
      });
      break;
  }
}

/** Clamp unseen offline runs at historical task terminals, including a later Undo. */
export function reconcileTerminalIntervals(state: StackMaps, events: readonly Event[]): void {
  const histories = new Map<string, { at: string; done: boolean; deleted: boolean }[]>();
  for (const event of events) {
    if (event.type !== "task.created" && event.type !== "task.updated") continue;
    const history = histories.get(event.taskId) ?? [];
    const before = history.at(-1) ?? { done: false, deleted: false };
    const next =
      event.type === "task.created"
        ? { at: event.at, done: event.status === "done", deleted: false }
        : {
            at: event.at,
            done: event.set.status !== undefined ? event.set.status === "done" : before.done,
            deleted: event.set.deleted ?? before.deleted,
          };
    history.push(next);
    histories.set(event.taskId, history);
  }
  for (const entry of state.dayEntries.values()) {
    const end = entry.taskId ? histories.get(entry.taskId)?.at(-1) : undefined;
    if (entry.status === "pending" && end && (end.done || end.deleted))
      state.dayEntries.set(entry.id, {
        ...entry,
        status: end.deleted ? "removed" : "done",
        updatedAt: end.at,
      });
  }
  for (const interval of state.workIntervals.values()) {
    const entry = state.dayEntries.get(interval.entryId);
    if (!entry?.taskId) continue;
    const history = histories.get(entry.taskId) ?? [];
    const startMs = Date.parse(interval.startedAt);
    const atStart = history.filter((point) => Date.parse(point.at) <= startMs).at(-1);
    const terminal =
      atStart && (atStart.done || atStart.deleted)
        ? atStart
        : history.find((point) => Date.parse(point.at) > startMs && (point.done || point.deleted));
    if (!terminal) continue;
    // Device clock skew may put an offline start after the terminal: retain it with zero effective duration.
    const stop = Date.parse(terminal.at) < startMs ? interval.startedAt : terminal.at;
    if (interval.endedAt == null || Date.parse(stop) < Date.parse(interval.endedAt)) {
      state.workIntervals.set(interval.id, {
        ...interval,
        endedAt: stop,
        ...(Date.parse(terminal.at) < startMs
          ? { reviewReason: "task_terminal_before_start" as const }
          : {}),
        updatedAt:
          Date.parse(interval.updatedAt) > Date.parse(terminal.at)
            ? interval.updatedAt
            : terminal.at,
      });
    }
  }
}
