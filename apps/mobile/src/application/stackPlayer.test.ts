import {
  DeviceId,
  EventId,
  deriveEntryTime,
  foldEvents,
  type BatchCommand,
  type Event,
  type FoldedEntities,
} from "@yatma/core";
import { describe, expect, it, vi } from "vite-plus/test";

import { lastSeenAtFromEvents } from "../db/entities";
import { createLocalMutationWriter, localUserActor } from "./mutations";
import { createStackPlayerRuntime, type ReminderPort } from "./stackPlayer";
import { createReminderAdapter } from "./reminders";

const nativeNotifications = vi.hoisted(() => ({
  pending: new Map<string, string>(),
  scheduleGate: null as Promise<void> | null,
  startedBodies: [] as string[],
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  cancelScheduledNotificationAsync: async (identifier: string) => {
    nativeNotifications.pending.delete(identifier);
  },
  getPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async (request: {
    readonly identifier: string;
    readonly content: { readonly body: string };
  }) => {
    nativeNotifications.startedBodies.push(request.content.body);
    if (request.content.body.includes("Previous account") && nativeNotifications.scheduleGate) {
      await nativeNotifications.scheduleGate;
    }
    nativeNotifications.pending.set(request.identifier, request.content.body);
    return request.identifier;
  },
}));

const deviceId = "device-player";
const startedAt = "2026-11-10T00:00:00.000Z";

function initialState(): FoldedEntities {
  const base = { v: 1 as const, by: localUserActor(deviceId), at: startedAt };
  const events: readonly Event[] = [
    {
      ...base,
      id: EventId.make("00000000000000000000000001"),
      type: "day.created",
      day: {
        id: "day-a",
        date: "2026-11-10",
        timezone: "Pacific/Auckland",
        assembled: true,
        suppressedBreakOrigins: [],
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    },
    {
      ...base,
      id: EventId.make("00000000000000000000000002"),
      type: "dayEntry.created",
      entry: {
        id: "entry-a",
        dayId: "day-a",
        kind: "activity",
        taskId: null,
        title: "Focus",
        allocationMinutes: 10,
        position: "a",
        status: "pending",
        origin: "manual:entry-a",
        manual: true,
        carryOrder: null,
        preparation: false,
        resumeEntryId: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    },
  ];
  return foldEvents(events);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(
  options: {
    readonly reminders?: ReminderPort;
    readonly execute?: (commands: readonly BatchCommand[]) => Promise<unknown>;
  } = {},
) {
  let folded = initialState();
  let now = "2026-11-10T00:00:01.000Z";
  let generation = 0;
  let nextId = 0;
  let failCommit = false;
  let commitGate: Promise<void> | undefined;
  const replace = vi.fn<ReminderPort["replace"]>(async (reminder) =>
    reminder ? "scheduled" : "off",
  );
  const writer = createLocalMutationWriter({
    readSnapshot: async () => ({
      folded,
      deviceId,
      lastSeenAt: lastSeenAtFromEvents(folded.events),
    }),
    commitBatch: async (events) => {
      if (commitGate) await commitGate;
      if (failCommit) throw new Error("injected storage failure");
      const next = foldEvents([...folded.events, ...events]);
      folded = next;
      return next;
    },
    publish: (next) => {
      folded = next;
    },
    sessionGeneration: () => generation,
    now: () => now,
  });
  const runtime = createStackPlayerRuntime({
    read: () => folded,
    execute: options.execute ?? ((commands) => writer.execute(commands, localUserActor(deviceId))),
    deviceId: () => deviceId,
    generation: () => generation,
    now: () => now,
    newId: () => `interval-${++nextId}`,
    reminders: options.reminders ?? { replace },
  });
  return {
    runtime,
    replace,
    get folded() {
      return folded;
    },
    set now(value: string) {
      now = value;
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
    set commitGate(value: Promise<void>) {
      commitGate = value;
    },
    switchAccount() {
      generation += 1;
      folded = foldEvents([]);
      runtime.reset();
    },
  };
}

describe("account-owned stack player runtime", () => {
  it("does not let an obsolete account reminder adapter cancel its successor's reminder", async () => {
    nativeNotifications.pending.clear();
    const previousAccount = createReminderAdapter();
    const currentAccount = createReminderAdapter();
    await previousAccount.replace({ title: "Previous account", at: "2026-11-10T00:10:00.000Z" });
    await currentAccount.replace({ title: "Current account", at: "2026-11-10T00:20:00.000Z" });
    await previousAccount.replace(null);
    expect(
      [...nativeNotifications.pending.values()].some((body) => body.includes("Current account")),
    ).toBe(true);
    await currentAccount.replace(null);
    expect(nativeNotifications.pending.size).toBe(0);
  });

  it("cleans up a late old-account native schedule before installing the successor reminder", async () => {
    nativeNotifications.pending.clear();
    nativeNotifications.startedBodies.length = 0;
    const gate = deferred();
    nativeNotifications.scheduleGate = gate.promise;
    const previousAccount = createReminderAdapter();
    const previous = previousAccount.replace({
      title: "Previous account",
      at: "2026-11-10T00:10:00.000Z",
    });
    await vi.waitFor(() => expect(nativeNotifications.startedBodies).toHaveLength(1));
    const currentAccount = createReminderAdapter();
    const current = currentAccount.replace({
      title: "Current account",
      at: "2026-11-10T00:20:00.000Z",
    });
    const staleCleanup = previousAccount.replace(null);
    gate.resolve();
    expect(await previous).toBe("off");
    expect(await current).toBe("scheduled");
    await staleCleanup;
    expect([...nativeNotifications.pending.values()]).toHaveLength(1);
    expect([...nativeNotifications.pending.values()][0]).toContain("Current account");
    nativeNotifications.scheduleGate = null;
    await currentAccount.replace(null);
  });
  it("shares pending state across callers and submits one start until commit completes", async () => {
    const h = harness();
    const gate = deferred();
    h.commitGate = gate.promise;
    const started = h.runtime.play("entry-a");
    expect(h.runtime.getSnapshot().pending).toBe(true);
    expect(await h.runtime.play("entry-a")).toBe(false);
    expect(h.folded.workIntervals.size).toBe(0);
    gate.resolve();
    expect(await started).toBe(true);
    expect(h.folded.workIntervals.size).toBe(1);
    expect(h.runtime.getSnapshot()).toMatchObject({
      pending: false,
      error: null,
      reminder: "scheduled",
    });
  });

  it("retains committed timing state and does not schedule a reminder when a write fails", async () => {
    const h = harness();
    h.failCommit = true;
    expect(await h.runtime.play("entry-a")).toBe(false);
    expect(h.folded.workIntervals.size).toBe(0);
    expect(h.folded.dayEntries.get("entry-a")?.status).toBe("pending");
    expect(h.runtime.getSnapshot()).toMatchObject({
      pending: false,
      error: "Local changes could not be saved",
      reminder: "off",
    });
    expect(h.replace).not.toHaveBeenCalled();
    h.failCommit = false;
    expect(await h.runtime.play("entry-a")).toBe(true);
    expect(h.runtime.getSnapshot().error).toBeNull();
  });

  it("records paused boundaries, excludes paused time, and replaces reminders after resuming", async () => {
    const h = harness();
    expect(await h.runtime.play("entry-a")).toBe(true);
    h.now = "2026-11-10T00:01:01.000Z";
    expect(await h.runtime.pause("entry-a")).toBe(true);
    expect(h.replace).toHaveBeenLastCalledWith(null);
    h.now = "2026-11-10T00:11:01.000Z";
    expect(await h.runtime.play("entry-a")).toBe(true);
    h.now = "2026-11-10T00:13:01.000Z";
    const entry = h.folded.dayEntries.get("entry-a")!;
    const time = deriveEntryTime(
      entry,
      [...h.folded.workIntervals.values()],
      "2026-11-10T00:13:01.000Z",
    );
    expect(time.actualSeconds).toBe(180);
    expect(time.remainingSeconds).toBe(420);
    expect(h.folded.workIntervals.size).toBe(2);
    expect(h.replace).toHaveBeenLastCalledWith({ title: "Focus", at: "2026-11-10T00:20:01.000Z" });
  });

  it("keeps committed playback successful when reminders are unavailable", async () => {
    const replace = vi.fn<ReminderPort["replace"]>(async () => {
      throw new Error("permission denied");
    });
    const h = harness({ reminders: { replace } });
    expect(await h.runtime.play("entry-a")).toBe(true);
    expect([...h.folded.workIntervals.values()][0]?.endedAt).toBeNull();
    expect(h.runtime.getSnapshot()).toEqual({
      pending: false,
      error: null,
      reminder: "unavailable",
    });
  });

  it("discards stale mutation errors after the account generation changes", async () => {
    const gate = deferred();
    const h = harness({
      execute: async () => {
        await gate.promise;
        throw new Error("old account failure");
      },
    });
    const action = h.runtime.play("entry-a");
    h.switchAccount();
    gate.resolve();
    expect(await action).toBe(false);
    expect(h.runtime.getSnapshot()).toEqual({ pending: false, error: null, reminder: "off" });
    expect(h.folded.workIntervals.size).toBe(0);
  });

  it("cancels a reminder that finishes scheduling after account teardown", async () => {
    const gate = deferred();
    const replace = vi.fn<ReminderPort["replace"]>(async (reminder) => {
      if (reminder) await gate.promise;
      return reminder ? "scheduled" : "off";
    });
    const h = harness({ reminders: { replace } });
    const action = h.runtime.play("entry-a");
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    h.switchAccount();
    gate.resolve();
    expect(await action).toBe(false);
    await vi.waitFor(() => expect(replace).toHaveBeenLastCalledWith(null));
    expect(h.runtime.getSnapshot()).toEqual({ pending: false, error: null, reminder: "off" });
  });

  it("reconciles restored interval timestamps without appending per-second events", async () => {
    const h = harness();
    expect(await h.runtime.play("entry-a")).toBe(true);
    const eventCount = h.folded.events.length;
    h.now = "2026-11-10T00:04:01.000Z";
    await h.runtime.reconcile();
    expect(h.folded.events).toHaveLength(eventCount);
    expect(h.replace).toHaveBeenLastCalledWith({ title: "Focus", at: "2026-11-10T00:10:01.000Z" });
    const restored = [...h.folded.workIntervals.values()][0]!;
    expect(restored.deviceId).toBe(DeviceId.make(deviceId));
    expect(restored.endedAt).toBeNull();
  });
});
