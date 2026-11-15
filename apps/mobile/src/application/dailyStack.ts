import {
  stackDayId,
  type BatchCommand,
  type StackPreferencesUpdatedFields,
  type TaskId,
} from "@yatma/core";

/** Calendar identity is supplied by the planning timezone, rather than UTC slicing. */
export function localPlanningDay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  function value(type: string) {
    return parts.find((part) => part.type === type)!.value;
  }
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Daily operations use the same serialized, account-fenced writer as ordinary tasks. */
export function createDailyStack(execute: (commands: readonly BatchCommand[]) => Promise<unknown>) {
  async function ensureToday(date: string, timezone: string, assemble = true) {
    const dayId = stackDayId(date, timezone);
    await execute([
      { type: "day.ensure", date, timezone },
      ...(assemble ? [{ type: "day.assemble" as const, dayId, includeBacklog: false }] : []),
    ]);
    return dayId;
  }
  /** Today is a scheduling shortcut; core derives the daily execution entry. */
  function scheduleTask(
    taskId: TaskId,
    scheduledDate: string | null,
    date: string,
    timezone: string,
  ) {
    return execute([
      { type: "task.update", input: { taskId, scheduledDate } },
      { type: "day.ensure", date, timezone },
    ]);
  }
  function preferences(set: StackPreferencesUpdatedFields) {
    return execute([{ type: "preferences.update", set }]);
  }
  return { ensureToday, scheduleTask, preferences, execute };
}
