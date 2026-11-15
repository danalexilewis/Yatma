import {
  type BatchCommand,
  type BuildContextInput,
  type FoldedEntities,
  type PlanningContext,
  PlanDayTool,
  ReadDayTool,
  defaultStackPreferences,
  generateEventId,
  selectDayEntries,
  stackDayId,
  taskDayEntryId,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as EventStore from "../eventStore.ts";
import type { ToolActorContext, ToolFailure } from "./tools.ts";

export type ReadDayInput = Schema.Schema.Type<typeof ReadDayTool.parametersSchema>;
export type PlanDayInput = Schema.Schema.Type<typeof PlanDayTool.parametersSchema>;

function failure(message: string): ToolFailure {
  return { _tag: "ToolFailure", message };
}

/** A read never creates a day, selects backlog tasks, or starts a work interval. */
export const readDay = Effect.fn("AgentTools.readDay")(function* (input: ReadDayInput) {
  const parsed = Schema.decodeUnknownOption(ReadDayTool.parametersSchema)(input);
  if (Option.isNone(parsed)) return failure("Use a valid planning date and timezone");
  const folded = yield* EventStore.loadFolded;
  const id = stackDayId(parsed.value.date, parsed.value.timezone);
  return {
    day: folded.days.get(id) ?? null,
    entries: selectDayEntries(folded.dayEntries, id, true),
    intervals: [...folded.workIntervals.values()].filter((interval) => interval.dayId === id),
    preferences: folded.stackPreferences.get("default") ?? defaultStackPreferences,
  };
});

/** Compile explicit selections into the existing serialized writer; no model runs inside its lock. */
export const planDay = Effect.fn("AgentTools.planDay")(function* (
  rawInput: PlanDayInput,
  ctx: ToolActorContext,
) {
  const parsed = Schema.decodeUnknownOption(PlanDayTool.parametersSchema)(rawInput);
  if (Option.isNone(parsed)) return failure("Invalid daily planning operations");
  const input = parsed.value;
  if (!input.reason.trim()) return failure("Explain the requested daily-plan changes");
  if (!ctx.mutations) return failure("Daily planning requires the serialized mutation writer");
  const folded = yield* EventStore.loadFolded;
  const dayId = stackDayId(input.date, input.timezone);
  const owned = new Map([...folded.dayEntries.values()].map((entry) => [entry.id, entry.dayId]));
  const linked = new Set(
    [...folded.dayEntries.values()]
      .filter((entry) => entry.taskId !== null)
      .map((entry) => entry.id),
  );
  const commands: BatchCommand[] = [
    { type: "day.ensure", date: input.date, timezone: input.timezone },
  ];

  for (const op of input.ops) {
    if (op.op === "add_task") {
      const id = taskDayEntryId(dayId, op.taskId);
      owned.set(id, dayId);
      linked.add(id);
      commands.push({
        type: "day.add",
        dayId,
        kind: "task",
        taskId: op.taskId,
        ...(op.allocationMinutes === undefined ? {} : { allocationMinutes: op.allocationMinutes }),
      });
      continue;
    }
    if (op.op === "add_activity") {
      commands.push({
        type: "day.add",
        dayId,
        kind: op.kind,
        title: op.title,
        allocationMinutes: op.allocationMinutes,
        entryId: `plan_${generateEventId()}`,
      });
      continue;
    }
    if (owned.get(op.entryId) !== dayId)
      return failure(`Entry does not belong to the requested planning day: ${op.entryId}`);
    if (op.op === "move_entry") {
      if (op.beforeEntryId !== null && owned.get(op.beforeEntryId) !== dayId)
        return failure(
          `Move target does not belong to the requested planning day: ${op.beforeEntryId}`,
        );
      commands.push({ type: "day.move", entryId: op.entryId, beforeEntryId: op.beforeEntryId });
    } else if (op.op === "remove_entry") {
      commands.push({ type: "day.remove", entryId: op.entryId });
    } else {
      if (op.title === undefined && op.allocationMinutes === undefined)
        return failure("Provide a title or allocation change for the daily entry");
      if (op.title !== undefined && linked.has(op.entryId))
        return failure(
          "Rename linked tasks with apply_changes; daily entry titles are for activities and breaks",
        );
      commands.push({
        type: "day.update",
        entryId: op.entryId,
        set: {
          ...(op.title === undefined ? {} : { title: op.title }),
          ...(op.allocationMinutes === undefined
            ? {}
            : { allocationMinutes: op.allocationMinutes }),
        },
      });
    }
  }

  const committed = yield* Effect.result(
    ctx.mutations.executeBatch({
      commands,
      actor: ctx.actor,
      batchId: ctx.batchId,
      now: ctx.nowIso,
      reason: input.reason.trim(),
    }),
  );
  if (Result.isFailure(committed)) {
    const error = committed.failure;
    return failure(
      error._tag === "planning_failed"
        ? error.failure.message
        : "Could not commit the daily plan; no partial plan was saved",
    );
  }
  return {
    batchId: committed.success.batchId,
    events: committed.success.events,
    summary:
      committed.success.events.length === 0
        ? "Today's plan is unchanged"
        : `Updated the selected day plan (${input.ops.length} requested change${input.ops.length === 1 ? "" : "s"})`,
  };
});

function calendarInZone(now: string, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    return ["year", "month", "day"]
      .map((part) => parts.find((value) => value.type === part)!.value)
      .join("-");
  } catch {
    return null;
  }
}

/** Prefer the device's explicit planning context; legacy turns use observed day data or ask. */
export function planningContextForTurn(
  folded: FoldedEntities,
  explicit: PlanningContext | undefined,
  now: string,
): NonNullable<BuildContextInput["planning"]> {
  if (explicit)
    return {
      date: explicit.date,
      timezone: explicit.timezone,
      entries: selectDayEntries(
        folded.dayEntries,
        stackDayId(explicit.date, explicit.timezone),
        true,
      ),
    };
  const observed = [...folded.days.values()]
    .filter((day) => calendarInZone(now, day.timezone) === day.date)
    .toSorted((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1,
    )[0];
  if (observed)
    return {
      date: observed.date,
      timezone: observed.timezone,
      entries: selectDayEntries(folded.dayEntries, observed.id, true),
    };
  return { date: new Date(now).toISOString().slice(0, 10), timezone: null, entries: [] };
}
