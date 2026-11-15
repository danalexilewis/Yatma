import * as Schema from "effect/Schema";

import { DeviceId, TaskId, TrimmedNonEmptyString } from "./ids.ts";
import { CalendarDate, Title } from "./schemas.ts";
import {
  AllocationMinutes,
  DayEntryUpdatedFields,
  StackEntryKind,
  StackPreferencesUpdatedFields,
  StackTemplate,
  StackTimezone,
} from "./stackSchemas.ts";

/** Atomic daily-plan and interval actions consumed by the existing batch writer. */
export const DailyCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("day.ensure"),
    date: CalendarDate,
    timezone: StackTimezone,
  }),
  Schema.Struct({
    type: Schema.Literal("day.assemble"),
    dayId: TrimmedNonEmptyString,
    templateId: Schema.optional(Schema.NullOr(Schema.String)),
    append: Schema.optional(Schema.Boolean),
    includeBacklog: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("day.add"),
    dayId: TrimmedNonEmptyString,
    kind: StackEntryKind,
    taskId: Schema.optional(TaskId),
    title: Schema.optional(Title),
    allocationMinutes: Schema.optional(AllocationMinutes),
    origin: Schema.optional(Schema.String),
    entryId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("day.update"),
    entryId: TrimmedNonEmptyString,
    set: DayEntryUpdatedFields,
  }),
  Schema.Struct({
    type: Schema.Literal("day.move"),
    entryId: TrimmedNonEmptyString,
    beforeEntryId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("day.remove"), entryId: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("day.tomorrow"),
    entryId: TrimmedNonEmptyString,
    allocationMinutes: Schema.optional(AllocationMinutes),
  }),
  Schema.Struct({
    type: Schema.Literal("player.play"),
    entryId: TrimmedNonEmptyString,
    intervalId: TrimmedNonEmptyString,
    deviceId: DeviceId,
  }),
  Schema.Struct({ type: Schema.Literal("player.pause"), entryId: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("player.finish"), entryId: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("player.later"),
    entryId: TrimmedNonEmptyString,
    allocationMinutes: Schema.optional(AllocationMinutes),
  }),
  Schema.Struct({
    type: Schema.Literal("player.extend"),
    entryId: TrimmedNonEmptyString,
    minutes: AllocationMinutes,
  }),
  Schema.Struct({
    type: Schema.Literal("player.dismissBreak"),
    dayId: TrimmedNonEmptyString,
    threshold: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    type: Schema.Literal("player.correct"),
    intervalId: TrimmedNonEmptyString,
    seconds: Schema.NullOr(
      Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("player.break"),
    entryId: TrimmedNonEmptyString,
    breakEntryId: TrimmedNonEmptyString,
    intervalId: TrimmedNonEmptyString,
    deviceId: DeviceId,
  }),
  Schema.Struct({ type: Schema.Literal("template.save"), template: StackTemplate }),
  Schema.Struct({ type: Schema.Literal("preferences.update"), set: StackPreferencesUpdatedFields }),
]);
export type DailyCommand = typeof DailyCommand.Type;
