import { deriveEntryTime, DeviceId, type BatchCommand, type FoldedEntities } from "@yatma/core";

export type ReminderPort = {
  readonly replace: (
    reminder: { readonly title: string; readonly at: string } | null,
  ) => Promise<"scheduled" | "unavailable" | "off">;
};
export type PlayerRuntimeState = {
  readonly pending: boolean;
  readonly error: string | null;
  readonly reminder: "scheduled" | "unavailable" | "off";
};

/** Account-owned command and reminder coordinator; timestamps, not ticks, record effort. */
export function createStackPlayerRuntime(deps: {
  readonly read: () => FoldedEntities;
  readonly execute: (commands: readonly BatchCommand[]) => Promise<unknown>;
  readonly deviceId: () => string;
  readonly generation: () => number;
  readonly now: () => string;
  readonly newId: () => string;
  readonly reminders: ReminderPort;
}) {
  let state: PlayerRuntimeState = { pending: false, error: null, reminder: "off" };
  let generation = deps.generation();
  let revision = 0;
  let reminderTail = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish(set: Partial<PlayerRuntimeState>) {
    state = { ...state, ...set };
    for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function getSnapshot() {
    return state;
  }
  function reset() {
    generation = deps.generation();
    revision += 1;
    publish({ pending: false, error: null, reminder: "off" });
    reminderTail = reminderTail
      .then(() => deps.reminders.replace(null))
      .then(
        () => {},
        () => {},
      );
  }
  async function reconcile() {
    if (generation !== deps.generation()) reset();
    const ownRevision = ++revision;
    const ownGeneration = generation;
    const snapshot = deps.read();
    const intervals = [...snapshot.workIntervals.values()];
    const active = intervals.find(
      (interval) => interval.endedAt === null && interval.deviceId === deps.deviceId(),
    );
    const entry = active ? snapshot.dayEntries.get(active.entryId) : undefined;
    const time = entry ? deriveEntryTime(entry, intervals, deps.now()) : undefined;
    const reminder =
      entry && time && time.remainingSeconds > 0 && !time.needsClockReview
        ? {
            title:
              (entry.taskId ? snapshot.tasks.get(entry.taskId)?.title : undefined) ?? entry.title,
            at: new Date(Date.parse(deps.now()) + time.remainingSeconds * 1000).toISOString(),
          }
        : null;
    reminderTail = reminderTail.then(async () => {
      if (ownRevision !== revision || ownGeneration !== deps.generation()) return;
      try {
        const result = await deps.reminders.replace(reminder);
        if (ownRevision === revision && ownGeneration === deps.generation())
          publish({ reminder: result });
        else await deps.reminders.replace(null);
      } catch {
        if (ownRevision === revision && ownGeneration === deps.generation())
          publish({ reminder: "unavailable" });
      }
    });
    await reminderTail;
  }
  async function execute(commands: readonly BatchCommand[]): Promise<boolean> {
    if (generation !== deps.generation()) reset();
    if (state.pending) return false;
    const ownGeneration = generation;
    publish({ pending: true, error: null });
    try {
      await deps.execute(commands);
      if (ownGeneration === deps.generation()) await reconcile();
      return ownGeneration === deps.generation();
    } catch (error) {
      if (ownGeneration === deps.generation()) {
        publish({
          error: error instanceof Error ? error.message : "Could not save this change. Try again.",
        });
      }
      return false;
    } finally {
      if (ownGeneration === deps.generation()) publish({ pending: false });
    }
  }
  function play(entryId: string) {
    return execute([
      {
        type: "player.play",
        entryId,
        intervalId: deps.newId(),
        deviceId: DeviceId.make(deps.deviceId()),
      },
    ]);
  }
  function pause(entryId: string) {
    return execute([{ type: "player.pause", entryId }]);
  }
  function finish(entryId: string) {
    return execute([{ type: "player.finish", entryId }]);
  }
  function extend(entryId: string, minutes: number) {
    return execute([{ type: "player.extend", entryId, minutes }]);
  }
  function later(entryId: string, allocationMinutes?: number) {
    return execute([
      {
        type: "player.later",
        entryId,
        ...(allocationMinutes === undefined ? {} : { allocationMinutes }),
      },
    ]);
  }
  function tomorrow(entryId: string, allocationMinutes?: number) {
    return execute([
      {
        type: "day.tomorrow",
        entryId,
        ...(allocationMinutes === undefined ? {} : { allocationMinutes }),
      },
    ]);
  }
  function takeBreak(entryId: string) {
    return execute([
      {
        type: "player.break",
        entryId,
        breakEntryId: deps.newId(),
        intervalId: deps.newId(),
        deviceId: DeviceId.make(deps.deviceId()),
      },
    ]);
  }
  return {
    subscribe,
    getSnapshot,
    reset,
    reconcile,
    execute,
    play,
    pause,
    finish,
    extend,
    later,
    tomorrow,
    takeBreak,
  };
}
