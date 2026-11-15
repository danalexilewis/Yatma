/** Validate a calendar day without timezone conversion or date rollover. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

/** Encode the user's local calendar day for due-date comparisons. */
export function localCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Calendar arithmetic is independent of local daylight-saving transitions. */
export function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export type SchedulePreset = "today" | "this_week" | "next_week" | "later";

/** Monday-based weeks: this week's Sunday, next week's Monday; Later is unscheduled. */
export function scheduledDateForPreset(today: string, preset: SchedulePreset): string | null {
  if (preset === "later") return null;
  if (preset === "today") return today;
  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  const untilSunday = (7 - weekday) % 7;
  return addCalendarDays(today, preset === "this_week" ? untilSunday : untilSunday + 1);
}
