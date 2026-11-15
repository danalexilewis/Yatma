import * as Schema from "effect/Schema";

import { DeviceId, TaskId, TrimmedNonEmptyString } from "./ids.ts";
import { CalendarDate, Title } from "./schemas.ts";
import { isCalendarDate } from "./dates.ts";

/** New stack records require explicit ISO instants; permissive v1 task readers stay unchanged. */
export const StackTimestamp = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const match =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    return (
      (match !== null &&
        isCalendarDate(match[1]!) &&
        Number(match[2]) <= 23 &&
        Number(match[3]) <= 59 &&
        Number(match[4]) <= 59 &&
        Number.isFinite(Date.parse(value))) ||
      "Use a valid ISO timestamp with an explicit timezone"
    );
  }),
);

/** Planning retains an IANA timezone that the platform can actually resolve. */
export const StackTimezone = Schema.String.check(
  Schema.makeFilter((value: string) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return value.length > 0;
    } catch {
      return "Use a valid planning timezone";
    }
  }),
);

export const AllocationMinutes = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(1440),
);
export const StackEntryKind = Schema.Literals(["task", "activity", "break"]);
export type StackEntryKind = typeof StackEntryKind.Type;
export const EntryDisposition = Schema.Literals([
  "pending",
  "done",
  "removed",
  "deferred",
  "skipped",
]);
export const Day = Schema.Struct({
  id: TrimmedNonEmptyString,
  date: CalendarDate,
  timezone: StackTimezone,
  assembled: Schema.Boolean,
  suppressedBreakOrigins: Schema.Array(Schema.String),
  dismissedBreakThresholds: Schema.optional(
    Schema.Array(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
  ),
  createdAt: StackTimestamp,
  updatedAt: StackTimestamp,
});
export type Day = typeof Day.Type;
export const DayUpdatedFields = Schema.Struct({
  assembled: Schema.optional(Schema.Boolean),
  suppressedBreakOrigins: Schema.optional(Schema.Array(Schema.String)),
  dismissedBreakThresholds: Schema.optional(
    Schema.Array(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
  ),
});
export const DayEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  dayId: TrimmedNonEmptyString,
  kind: StackEntryKind,
  taskId: Schema.NullOr(TaskId),
  title: Title,
  allocationMinutes: AllocationMinutes,
  position: TrimmedNonEmptyString,
  status: EntryDisposition,
  origin: TrimmedNonEmptyString,
  manual: Schema.Boolean,
  carryOrder: Schema.NullOr(StackTimestamp),
  preparation: Schema.Boolean,
  resumeEntryId: Schema.NullOr(Schema.String),
  createdAt: StackTimestamp,
  updatedAt: StackTimestamp,
});
export type DayEntry = typeof DayEntry.Type;
export const DayEntryUpdatedFields = Schema.Struct({
  title: Schema.optional(Title),
  allocationMinutes: Schema.optional(AllocationMinutes),
  position: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(EntryDisposition),
  manual: Schema.optional(Schema.Boolean),
  carryOrder: Schema.optional(Schema.NullOr(StackTimestamp)),
});
export type DayEntryUpdatedFields = typeof DayEntryUpdatedFields.Type;
export const WorkInterval = Schema.Struct({
  id: TrimmedNonEmptyString,
  entryId: TrimmedNonEmptyString,
  dayId: TrimmedNonEmptyString,
  deviceId: DeviceId,
  startedAt: StackTimestamp,
  endedAt: Schema.NullOr(StackTimestamp),
  reviewReason: Schema.optional(
    Schema.NullOr(Schema.Literals(["task_terminal_before_start", "clock_discontinuity"])),
  ),
  correctedSeconds: Schema.NullOr(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  updatedAt: StackTimestamp,
}).check(
  Schema.makeFilter(
    (interval) =>
      interval.endedAt === null ||
      Date.parse(interval.endedAt) >= Date.parse(interval.startedAt) ||
      "Interval end must not precede its start",
  ),
);
export type WorkInterval = typeof WorkInterval.Type;
export const WorkIntervalUpdatedFields = Schema.Struct({
  reviewReason: Schema.optional(
    Schema.NullOr(Schema.Literals(["task_terminal_before_start", "clock_discontinuity"])),
  ),
  endedAt: Schema.optional(Schema.NullOr(StackTimestamp)),
  correctedSeconds: Schema.optional(
    Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  ),
});
export const TemplateItem = Schema.Struct({
  key: TrimmedNonEmptyString,
  kind: StackEntryKind,
  title: Title,
  allocationMinutes: AllocationMinutes,
  taskId: Schema.optional(Schema.NullOr(TaskId)),
  preparation: Schema.optional(Schema.Boolean),
});
export const StackTemplate = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),
  id: TrimmedNonEmptyString,
  version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  title: Title,
  items: Schema.Array(TemplateItem),
  updatedAt: StackTimestamp,
});
export type StackTemplate = typeof StackTemplate.Type;
export const StackPreferenceFields = {
  automaticBreaks: Schema.Boolean,
  workIntervalMinutes: AllocationMinutes,
  breakMinutes: AllocationMinutes,
  defaultAllocationMinutes: AllocationMinutes,
  openingTemplateId: Schema.NullOr(Schema.String),
  scene: Schema.Literals(["quiet", "forest", "rain", "ocean"]),
  volume: Schema.Number.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1),
  ),
  muted: Schema.Boolean,
};
export const StackPreferences = Schema.Struct({
  ...StackPreferenceFields,
  updatedAt: StackTimestamp,
});
export type StackPreferences = typeof StackPreferences.Type;
export const StackPreferencesUpdatedFields = Schema.Struct({
  automaticBreaks: Schema.optional(StackPreferenceFields.automaticBreaks),
  workIntervalMinutes: Schema.optional(StackPreferenceFields.workIntervalMinutes),
  breakMinutes: Schema.optional(StackPreferenceFields.breakMinutes),
  defaultAllocationMinutes: Schema.optional(StackPreferenceFields.defaultAllocationMinutes),
  openingTemplateId: Schema.optional(StackPreferenceFields.openingTemplateId),
  scene: Schema.optional(StackPreferenceFields.scene),
  volume: Schema.optional(StackPreferenceFields.volume),
  muted: Schema.optional(StackPreferenceFields.muted),
});
export type StackPreferencesUpdatedFields = typeof StackPreferencesUpdatedFields.Type;

export const defaultStackPreferences: StackPreferences = {
  automaticBreaks: true,
  workIntervalMinutes: 120,
  breakMinutes: 5,
  defaultAllocationMinutes: 30,
  openingTemplateId: "admin",
  scene: "quiet",
  volume: 0.5,
  muted: true,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export const ADMIN_TEMPLATE: StackTemplate = {
  id: "admin",
  version: 1,
  title: "Admin opening",
  updatedAt: "1970-01-01T00:00:00.000Z",
  items: [
    {
      key: "mindfulness",
      kind: "activity",
      title: "Mindfulness",
      allocationMinutes: 10,
      preparation: true,
    },
    {
      key: "reprioritise",
      kind: "activity",
      title: "Reprioritise",
      allocationMinutes: 5,
      preparation: true,
    },
    { key: "email", kind: "activity", title: "Clear email", allocationMinutes: 30 },
  ],
};
