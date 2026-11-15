import * as Result from "effect/Result";

import type { BatchSnapshot, EventDraft, PlanBatchContext } from "./batch.ts";
import type { DailyCommand } from "./dailyCommands.ts";
import type { Event } from "./events.ts";
import type { EventId, TaskId } from "./ids.ts";
import type { Day, DayEntry, DayEntryUpdatedFields, StackTemplate } from "./stackSchemas.ts";
import { ADMIN_TEMPLATE, defaultStackPreferences } from "./stackSchemas.ts";
import { addCalendarDays } from "./dates.ts";
import {
  generatedDayEntryId,
  positionBefore,
  selectDayEntries,
  stackDayId,
  taskDayEntryId,
} from "./dailyStack.ts";
import { generateSpreadOrderKeys, orderKeyBetween } from "./orderKey.ts";
import { sortTasksByPosition } from "./rules.ts";
import { applyStackEvent, copyStackMaps } from "./stackFold.ts";
import { deriveEntryTime } from "./stackPlayer.ts";
import { instantiateTemplate, reconcileAutomaticBreaks } from "./stackTemplates.ts";

export type DailyFailure = {
  readonly code: "invalid_command" | "missing_reference" | "entity_conflict";
  readonly message: string;
  readonly entityId?: string;
};
type Payload = Event extends infer E
  ? E extends Event
    ? Omit<E, "id" | "at" | "seq" | "v" | "by" | "batch" | "undoes">
    : never
  : never;
const ZERO_ID = "00000000000000000000000000" as EventId;

/** Plan daily commands through the same atomic event-draft boundary as task edits. */
export function planDailyCommand(
  snapshot: BatchSnapshot,
  command: DailyCommand,
  context: PlanBatchContext,
): Result.Result<readonly EventDraft[], DailyFailure> {
  const suppliedNow = context.now;
  if (!suppliedNow || !Number.isFinite(Date.parse(suppliedNow)))
    return Result.fail({
      code: "invalid_command",
      message: "Daily commands require a valid supplied clock",
    });
  const now = new Date(suppliedNow).toISOString();
  const state = copyStackMaps(snapshot);
  const output: EventDraft[] = [];
  let preferences = { ...defaultStackPreferences, ...state.stackPreferences.get("default") };
  function emit(payload: Payload): void {
    const draft = {
      ...payload,
      v: 1,
      by: context.actor,
      ...(context.reason?.trim() ? { reason: context.reason.trim() } : {}),
      ...(context.batchId ? { batch: context.batchId } : {}),
      ...(context.undoes ? { undoes: context.undoes } : {}),
    } as EventDraft;
    output.push(draft);
    applyStackEvent(state, { ...draft, id: ZERO_ID, at: now! } as Event);
  }
  function invalid(
    message: string,
    entityId?: string,
  ): Result.Result<readonly EventDraft[], DailyFailure> {
    return Result.fail({ code: "invalid_command", message, ...(entityId ? { entityId } : {}) });
  }
  function missing(entityId: string): Result.Result<readonly EventDraft[], DailyFailure> {
    return Result.fail({
      code: "missing_reference",
      message: "Daily entity does not exist",
      entityId,
    });
  }
  function ensureDay(date: string, timezone: string): Day {
    const id = stackDayId(date, timezone);
    const existing = state.days.get(id);
    if (existing) return existing;
    const day: Day = {
      id,
      date,
      timezone,
      assembled: false,
      suppressedBreakOrigins: [],
      createdAt: now!,
      updatedAt: now!,
    };
    emit({ type: "day.created", day });
    return day;
  }
  function updateEntry(entry: DayEntry, set: DayEntryUpdatedFields): void {
    const actual = Object.fromEntries(
      Object.entries(set).filter(([key, value]) => value !== entry[key as keyof DayEntry]),
    );
    if (Object.keys(actual).length === 0) return;
    const prev = Object.fromEntries(
      Object.keys(actual).map((key) => [key, entry[key as keyof DayEntry]]),
    );
    emit({ type: "dayEntry.updated", entryId: entry.id, set: actual, prev });
  }
  function closeEntry(entryId: string, deviceId?: string): void {
    for (const interval of state.workIntervals.values()) {
      if (
        interval.entryId !== entryId ||
        interval.endedAt !== null ||
        (deviceId && interval.deviceId !== deviceId)
      )
        continue;
      emit({
        type: "workInterval.updated",
        intervalId: interval.id,
        set: {
          endedAt: Date.parse(now!) < Date.parse(interval.startedAt) ? interval.startedAt : now!,
          ...(Date.parse(now!) < Date.parse(interval.startedAt)
            ? { reviewReason: "clock_discontinuity" as const }
            : {}),
        },
        prev: { endedAt: null },
      });
    }
  }
  function reconcile(dayId: string): void {
    const day = state.days.get(dayId);
    if (!day) return;
    const all = selectDayEntries(state.dayEntries, dayId, true);
    const change = reconcileAutomaticBreaks(
      day,
      all,
      [...state.workIntervals.values()],
      preferences,
      now!,
    );
    for (const entry of change.create) emit({ type: "dayEntry.created", entry });
    for (const id of change.revive) updateEntry(state.dayEntries.get(id)!, { status: "pending" });
    for (const id of change.remove) updateEntry(state.dayEntries.get(id)!, { status: "removed" });
    for (const update of change.update)
      updateEntry(state.dayEntries.get(update.entryId)!, update.set);
  }
  function addEntry(
    dayId: string,
    values: {
      kind: DayEntry["kind"];
      taskId?: TaskId | undefined;
      title?: string | undefined;
      allocationMinutes?: number | undefined;
      origin?: string | undefined;
      entryId?: string | undefined;
      position?: string | undefined;
      manual?: boolean | undefined;
    },
  ): DayEntry | null {
    const task = values.taskId ? snapshot.tasks.get(values.taskId) : undefined;
    if (values.kind === "task" && (!task || task.deletedAt !== null || task.status === "done"))
      return null;
    const id = values.taskId
      ? taskDayEntryId(dayId, values.taskId)
      : (values.entryId ?? generatedDayEntryId(dayId, values.origin ?? "manual"));
    const existing = state.dayEntries.get(id);
    if (existing) return existing;
    const pending = selectDayEntries(state.dayEntries, dayId);
    const entry: DayEntry = {
      id,
      dayId,
      kind: values.taskId ? "task" : values.kind,
      taskId: values.taskId ?? null,
      title: values.title ?? task?.title ?? (values.kind === "break" ? "Break" : "Activity"),
      allocationMinutes:
        values.allocationMinutes ??
        task?.estimateMinutes ??
        (values.kind === "break" ? preferences.breakMinutes : preferences.defaultAllocationMinutes),
      position: values.position ?? orderKeyBetween(pending.at(-1)?.position ?? null, null) ?? "n",
      status: "pending",
      origin: values.origin ?? `manual:${id}`,
      manual: values.manual ?? true,
      carryOrder: null,
      preparation: false,
      resumeEntryId: null,
      createdAt: now!,
      updatedAt: now!,
    };
    emit({ type: "dayEntry.created", entry });
    return entry;
  }

  function scheduleLinkedTask(taskId: TaskId, date: string | null) {
    const task = snapshot.tasks.get(taskId);
    if (task && (task.scheduledDate ?? null) !== date)
      emit({
        type: "task.updated",
        taskId,
        set: { scheduledDate: date },
        prev: { scheduledDate: task.scheduledDate ?? null },
      });
  }
  function syncSchedule(day: Day) {
    for (const entry of selectDayEntries(state.dayEntries, day.id)) {
      if (!entry.taskId) continue;
      const task = snapshot.tasks.get(entry.taskId);
      if (!task || task.scheduledDate !== day.date || task.deletedAt || task.status === "done") {
        closeEntry(entry.id);
        updateEntry(entry, { status: "removed" });
      }
    }
    for (const task of sortTasksByPosition([...snapshot.tasks.values()])) {
      if (task.scheduledDate !== day.date || task.deletedAt || task.status === "done") continue;
      const entry = addEntry(day.id, { kind: "task", taskId: task.id, origin: "schedule" });
      if (entry && ["removed", "deferred"].includes(entry.status))
        updateEntry(entry, { status: "pending" });
    }
    reconcile(day.id);
  }

  if (command.type === "day.ensure") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: command.timezone }).format();
    } catch {
      return invalid("Use a valid planning timezone");
    }
    syncSchedule(ensureDay(command.date, command.timezone));
  } else if (command.type === "template.save") {
    const existing =
      state.stackTemplates.get(command.template.id) ??
      (command.template.id === "admin" ? ADMIN_TEMPLATE : undefined);
    if (existing && existing.version > command.template.version)
      return invalid("Template versions cannot go backwards");
    if (existing && sameTemplate(existing, command.template)) return Result.succeed([]);
    if (existing && existing.version === command.template.version)
      return invalid("Changed templates require a new version");
    if (
      new Set(command.template.items.map((item) => item.key)).size !== command.template.items.length
    )
      return invalid("Template item keys must be unique");
    emit({
      type: "stackTemplate.saved",
      template: {
        ...command.template,
        archived: command.template.archived ?? false,
        updatedAt: now,
      },
      prev: existing ?? null,
    });
  } else if (command.type === "preferences.update") {
    const set = Object.fromEntries(
      Object.entries(command.set).filter(
        ([key, value]) => value !== preferences[key as keyof typeof preferences],
      ),
    );
    if (Object.keys(set).length) {
      emit({
        type: "stackPreferences.updated",
        set,
        prev: Object.fromEntries(
          Object.keys(set).map((key) => [key, preferences[key as keyof typeof preferences]]),
        ),
      });
      preferences = state.stackPreferences.get("default")!;
      if (["automaticBreaks", "workIntervalMinutes", "breakMinutes"].some((key) => key in set)) {
        for (const day of state.days.values()) {
          let parts: Intl.DateTimeFormatPart[];
          try {
            parts = new Intl.DateTimeFormat("en", {
              timeZone: day.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(new Date(now));
          } catch {
            return invalid("Saved planning timezone is unavailable", day.id);
          }
          const localDate = ["year", "month", "day"]
            .map((part) => parts.find((value) => value.type === part)!.value)
            .join("-");
          if (day.assembled && day.date >= localDate) reconcile(day.id);
        }
      }
    }
  } else if (command.type === "player.dismissBreak") {
    const day = state.days.get(command.dayId);
    if (!day) return missing(command.dayId);
    if (!(day.dismissedBreakThresholds ?? []).includes(command.threshold))
      emit({
        type: "day.updated",
        dayId: day.id,
        set: {
          dismissedBreakThresholds: [...(day.dismissedBreakThresholds ?? []), command.threshold],
        },
        prev: { dismissedBreakThresholds: day.dismissedBreakThresholds ?? [] },
      });
  } else if (command.type === "player.correct") {
    const interval = state.workIntervals.get(command.intervalId);
    if (!interval) return missing(command.intervalId);
    if (interval.endedAt == null) return invalid("Pause before correcting recorded time");
    if (interval.correctedSeconds !== command.seconds)
      emit({
        type: "workInterval.updated",
        intervalId: interval.id,
        set: { correctedSeconds: command.seconds },
        prev: { correctedSeconds: interval.correctedSeconds },
      });
  } else if (command.type === "day.assemble") {
    const day = state.days.get(command.dayId);
    if (!day) return missing(command.dayId);
    if (day.assembled && !command.append) return Result.succeed([]);
    const templateId =
      command.templateId !== undefined ? command.templateId : preferences.openingTemplateId;
    const template =
      templateId == null
        ? undefined
        : (state.stackTemplates.get(templateId) ??
          (templateId === "admin" ? ADMIN_TEMPLATE : undefined));
    if (templateId != null && (!template || template.archived)) return missing(templateId);
    if (template)
      for (const entry of instantiateTemplate(template, day.id, now)) {
        if (entry.taskId) {
          const task = snapshot.tasks.get(entry.taskId);
          if (!task || task.status === "done" || task.deletedAt !== null) continue;
        }
        if (entry.taskId) scheduleLinkedTask(entry.taskId, day.date);
        if (!state.dayEntries.has(entry.id)) emit({ type: "dayEntry.created", entry });
      }
    const futurePlanned = new Set(
      [...state.dayEntries.values()]
        .filter((entry) => {
          const planned = state.days.get(entry.dayId);
          return entry.taskId && entry.status === "pending" && planned && planned.date > day.date;
        })
        .map((entry) => entry.taskId),
    );
    const queue =
      command.includeBacklog === false
        ? []
        : sortTasksByPosition([...snapshot.tasks.values()]).filter(
            (task) =>
              task.status !== "done" &&
              task.deletedAt === null &&
              !futurePlanned.has(task.id) &&
              (!task.scheduledDate || task.scheduledDate === day.date),
          );
    const positions = generateSpreadOrderKeys(queue.length);
    for (let i = 0; i < queue.length; i += 1) {
      const task = queue[i]!;
      scheduleLinkedTask(task.id, day.date);
      addEntry(day.id, {
        kind: "task",
        taskId: task.id,
        origin: "backlog",
        position: `t${positions[i]}`,
        manual: false,
      });
    }
    if (!day.assembled)
      emit({
        type: "day.updated",
        dayId: day.id,
        set: { assembled: true },
        prev: { assembled: false },
      });
    reconcile(day.id);
  } else if (command.type === "day.add") {
    const day = state.days.get(command.dayId);
    if (!day) return missing(command.dayId);
    if (command.kind === "task" && !command.taskId)
      return invalid("Task entries require a task ID");
    if (command.kind !== "task" && command.taskId)
      return invalid("Only task entries may link a task");
    if (command.kind !== "task" && !command.entryId && !command.origin)
      return invalid("Manual entries require a supplied identity");
    const entry = addEntry(day.id, command);
    if (!entry) return invalid("Task is missing, deleted or complete", command.taskId);
    if (entry.taskId) scheduleLinkedTask(entry.taskId, day.date);
    if (entry.status !== "pending" && entry.taskId) {
      const actualMinutes =
        deriveEntryTime(entry, [...state.workIntervals.values()], now).actualSeconds / 60;
      const freshMinutes =
        command.allocationMinutes ??
        snapshot.tasks.get(entry.taskId)?.estimateMinutes ??
        preferences.defaultAllocationMinutes;
      updateEntry(entry, {
        status: "pending",
        allocationMinutes: actualMinutes + freshMinutes,
        manual: true,
      });
    }
    reconcile(day.id);
  } else {
    const entry = state.dayEntries.get(command.entryId);
    if (!entry) return missing(command.entryId);
    const day = state.days.get(entry.dayId);
    if (!day) return missing(entry.dayId);
    const intervals = [...state.workIntervals.values()];
    if (command.type === "day.update") {
      if (command.set.status && command.set.status !== "pending") closeEntry(entry.id);
      updateEntry(entry, { ...command.set, manual: command.set.manual ?? true });
      reconcile(day.id);
    } else if (command.type === "day.move") {
      if (command.beforeEntryId === entry.id) return Result.succeed([]);
      const pending = selectDayEntries(state.dayEntries, day.id).filter(
        (item) => item.id !== entry.id,
      );
      const position = positionBefore(pending, command.beforeEntryId);
      if (!position) return invalid("Move target is unavailable");
      updateEntry(entry, { position, manual: true, carryOrder: null });
      reconcile(day.id);
    } else if (command.type === "day.remove") {
      if (entry.status !== "pending") return Result.succeed([]);
      if (entry.taskId && snapshot.tasks.get(entry.taskId)?.scheduledDate === day.date)
        scheduleLinkedTask(entry.taskId, null);
      closeEntry(entry.id);
      updateEntry(entry, { status: entry.kind === "break" ? "skipped" : "removed", manual: true });
      if (
        entry.origin.startsWith("auto-break:") &&
        !day.suppressedBreakOrigins.includes(entry.origin)
      )
        emit({
          type: "day.updated",
          dayId: day.id,
          set: { suppressedBreakOrigins: [...day.suppressedBreakOrigins, entry.origin] },
          prev: { suppressedBreakOrigins: day.suppressedBreakOrigins },
        });
      reconcile(day.id);
    } else if (command.type === "player.extend") {
      if (entry.allocationMinutes + command.minutes > 1440)
        return invalid("Allocation cannot exceed 1440 minutes");
      updateEntry(entry, {
        allocationMinutes: entry.allocationMinutes + command.minutes,
        manual: true,
      });
      reconcile(day.id);
    } else if (command.type === "player.pause") {
      if (context.actor.kind !== "user") return invalid("Only the owner device may pause playback");
      closeEntry(entry.id, context.actor.deviceId);
    } else if (command.type === "player.play") {
      if (context.actor.kind !== "user" || context.actor.deviceId !== command.deviceId)
        return invalid("Playback device must match the current user device");
      if (entry.status !== "pending") return invalid("Entry is not playable");
      const task = entry.taskId ? snapshot.tasks.get(entry.taskId) : undefined;
      if (entry.taskId && (!task || task.status === "done" || task.deletedAt !== null))
        return invalid("Linked task is unavailable");
      const existing = state.workIntervals.get(command.intervalId);
      if (existing)
        return existing.entryId === entry.id && existing.deviceId === command.deviceId
          ? Result.succeed([])
          : invalid("Interval identity already exists");
      const active = intervals.filter((interval) => interval.endedAt == null);
      if (active.some((interval) => interval.deviceId !== command.deviceId))
        return Result.fail({
          code: "entity_conflict",
          message: "Another device has an active run",
        });
      if (active.some((interval) => interval.entryId === entry.id)) return Result.succeed([]);
      // Starting elsewhere promotes that item and keeps the interrupted work next.
      const pending = selectDayEntries(state.dayEntries, day.id);
      const previousId =
        active.find((interval) => interval.dayId === day.id)?.entryId ??
        intervals
          .filter((interval) => interval.dayId === day.id)
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .find((interval) => pending.some((item) => item.id === interval.entryId))?.entryId ??
        pending[0]?.id;
      const previous = pending.find((item) => item.id === previousId && item.id !== entry.id);
      const rest = pending.filter((item) => item.id !== entry.id && item.id !== previous?.id);
      const previousPosition = previous ? positionBefore(rest, rest[0]?.id ?? null) : null;
      if (previous && previousPosition)
        updateEntry(previous, { position: previousPosition, manual: true, carryOrder: null });
      const position = orderKeyBetween(null, previousPosition ?? rest[0]?.position ?? null);
      if (position && (previous || pending[0]?.id !== entry.id))
        updateEntry(entry, { position, manual: true, carryOrder: null });
      for (const interval of active) closeEntry(interval.entryId);
      emit({
        type: "workInterval.created",
        interval: {
          id: command.intervalId,
          entryId: entry.id,
          dayId: day.id,
          deviceId: command.deviceId,
          startedAt: now,
          endedAt: null,
          correctedSeconds: null,
          updatedAt: now,
        },
      });
    } else if (command.type === "player.finish") {
      if (entry.status === "done") return Result.succeed([]);
      if (entry.status !== "pending") return invalid("Entry is not playable");
      closeEntry(entry.id);
      updateEntry(entry, { status: "done" });
      if (entry.taskId) {
        const task = snapshot.tasks.get(entry.taskId);
        if (task && task.status !== "done" && task.deletedAt === null) {
          emit({
            type: "task.updated",
            taskId: task.id,
            set: { status: "done" },
            prev: { status: task.status },
          });
          for (const other of state.dayEntries.values())
            if (other.taskId === task.id && other.status === "pending") {
              closeEntry(other.id);
              updateEntry(other, { status: "done" });
            }
        }
      }
    } else if (command.type === "player.later") {
      if (entry.status !== "pending") return Result.succeed([]);
      const remaining = deriveEntryTime(entry, intervals, now).remainingSeconds;
      if (remaining === 0 && command.allocationMinutes === undefined)
        return invalid("An exhausted entry needs a fresh positive allowance");
      closeEntry(entry.id);
      const pending = selectDayEntries(state.dayEntries, day.id).filter(
        (item) => item.id !== entry.id,
      );
      updateEntry(entry, {
        position: positionBefore(pending, null) ?? entry.position,
        manual: true,
        ...(command.allocationMinutes !== undefined
          ? {
              allocationMinutes:
                deriveEntryTime(entry, intervals, now).actualSeconds / 60 +
                command.allocationMinutes,
            }
          : {}),
      });
      reconcile(day.id);
    } else if (command.type === "day.tomorrow") {
      if (entry.status === "deferred") return Result.succeed([]);
      if (!entry.taskId) return invalid("Tomorrow requires a linked task");
      const remaining = deriveEntryTime(entry, intervals, now).remainingSeconds / 60;
      const allowance = command.allocationMinutes ?? remaining;
      if (!(allowance > 0)) return invalid("An exhausted entry needs a fresh positive allowance");
      const tomorrow = ensureDay(addCalendarDays(day.date, 1), day.timezone);
      scheduleLinkedTask(entry.taskId, tomorrow.date);
      closeEntry(entry.id);
      updateEntry(entry, { status: "deferred" });
      const target = selectDayEntries(state.dayEntries, tomorrow.id);
      const carried = target.filter((item) => item.carryOrder !== null);
      const firstWork = target.find((item) => !item.preparation && item.carryOrder === null);
      const before =
        carried.at(-1)?.position ??
        target.filter((item) => item.preparation).at(-1)?.position ??
        "f";
      const position =
        orderKeyBetween(before, firstWork?.position ?? "n") ?? positionBefore(target, null) ?? "j";
      const targetEntry = addEntry(tomorrow.id, {
        kind: "task",
        taskId: entry.taskId,
        allocationMinutes: allowance,
        position,
        origin: `carry:${entry.id}`,
        manual: false,
      });
      if (!targetEntry) return invalid("Linked task is unavailable");
      if (!targetEntry.manual && targetEntry.carryOrder === null)
        updateEntry(targetEntry, {
          status: "pending",
          position,
          carryOrder: now,
          allocationMinutes: allowance,
        });
      reconcile(day.id);
      if (tomorrow.assembled) reconcile(tomorrow.id);
    } else if (command.type === "player.break") {
      if (context.actor.kind !== "user" || context.actor.deviceId !== command.deviceId)
        return invalid("Playback device must match the current user device");
      if (entry.status !== "pending" || entry.kind === "break")
        return invalid("Take a break from an open work entry");
      if (
        intervals.some(
          (interval) => interval.endedAt === null && interval.deviceId !== command.deviceId,
        )
      )
        return Result.fail({
          code: "entity_conflict",
          message: "Another device has an active run",
        });
      for (const interval of intervals)
        if (interval.endedAt === null && interval.deviceId === command.deviceId)
          closeEntry(interval.entryId, command.deviceId);
      let breakEntry = state.dayEntries.get(command.breakEntryId);
      if (
        breakEntry &&
        (breakEntry.kind !== "break" ||
          breakEntry.dayId !== day.id ||
          breakEntry.status !== "pending")
      )
        return invalid("Break identity is unavailable");
      const existingInterval = state.workIntervals.get(command.intervalId);
      if (
        existingInterval &&
        (existingInterval.entryId !== command.breakEntryId ||
          existingInterval.deviceId !== command.deviceId)
      )
        return invalid("Interval identity already exists");
      if (!breakEntry) {
        const pending = selectDayEntries(state.dayEntries, day.id);
        const position = positionBefore(pending, entry.id) ?? entry.position;
        breakEntry = {
          id: command.breakEntryId,
          dayId: day.id,
          kind: "break",
          taskId: null,
          title: "Break",
          allocationMinutes: preferences.breakMinutes,
          position,
          status: "pending",
          origin: `manual:${command.breakEntryId}`,
          manual: true,
          carryOrder: null,
          preparation: false,
          resumeEntryId: entry.id,
          createdAt: now,
          updatedAt: now,
        };
        emit({ type: "dayEntry.created", entry: breakEntry });
      }
      if (!state.workIntervals.has(command.intervalId))
        emit({
          type: "workInterval.created",
          interval: {
            id: command.intervalId,
            entryId: breakEntry.id,
            dayId: day.id,
            deviceId: command.deviceId,
            startedAt: now,
            endedAt: null,
            correctedSeconds: null,
            updatedAt: now,
          },
        });
    }
  }
  return Result.succeed(output);
}

/** Shared task-terminal policy used by checkbox, detail, worker and player batches. */
export function taskTerminalDrafts(
  snapshot: BatchSnapshot,
  taskId: TaskId,
  deleted: boolean,
  context: PlanBatchContext,
): readonly EventDraft[] {
  const drafts: EventDraft[] = [];
  const now = context.now;
  const envelope = {
    v: 1 as const,
    by: context.actor,
    ...(context.reason?.trim() ? { reason: context.reason.trim() } : {}),
    ...(context.batchId ? { batch: context.batchId } : {}),
    ...(context.undoes ? { undoes: context.undoes } : {}),
  };
  for (const entry of snapshot.dayEntries?.values() ?? []) {
    if (entry.taskId !== taskId || entry.status !== "pending") continue;
    drafts.push({
      ...envelope,
      type: "dayEntry.updated",
      entryId: entry.id,
      set: { status: deleted ? "removed" : "done" },
      prev: { status: entry.status },
    });
    for (const interval of snapshot.workIntervals?.values() ?? []) {
      if (interval.entryId !== entry.id || interval.endedAt !== null || !now) continue;
      drafts.push({
        ...envelope,
        type: "workInterval.updated",
        intervalId: interval.id,
        set: {
          endedAt: Date.parse(now) < Date.parse(interval.startedAt) ? interval.startedAt : now,
        },
        prev: { endedAt: null },
      });
    }
  }
  return drafts;
}

function sameTemplate(left: StackTemplate, right: StackTemplate): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.title === right.title &&
    (left.archived ?? false) === (right.archived ?? false) &&
    left.items.length === right.items.length &&
    left.items.every((item, index) => {
      const other = right.items[index]!;
      return (
        item.key === other.key &&
        item.kind === other.kind &&
        item.title === other.title &&
        item.allocationMinutes === other.allocationMinutes &&
        (item.taskId ?? null) === (other.taskId ?? null) &&
        (item.preparation ?? false) === (other.preparation ?? false)
      );
    })
  );
}
