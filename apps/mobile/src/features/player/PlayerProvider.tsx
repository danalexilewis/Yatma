import {
  defaultStackPreferences,
  findIntervalOverlaps,
  selectDayEntries,
  stackDayId,
  type DayEntry,
  type StackPreferences,
} from "@yatma/core";
import { randomUUID } from "expo-crypto";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState as NativeAppState } from "react-native";

import { createDailyStack, localPlanningDay } from "../../application/dailyStack";
import { createReminderAdapter } from "../../application/reminders";
import { createStackPlayerRuntime, type PlayerRuntimeState } from "../../application/stackPlayer";
import { useAppStore, type AppState } from "../../state/atoms";
import { AmbientMedia } from "./AmbientMedia";

type StackPlayerContext = {
  readonly state: AppState;
  readonly now: string;
  readonly timezone: string;
  readonly date: string;
  readonly dayId: string;
  readonly entries: readonly DayEntry[];
  readonly active: DayEntry | undefined;
  readonly selected: DayEntry | undefined;
  readonly select: (entryId: string) => void;
  readonly daily: ReturnType<typeof createDailyStack>;
  readonly runtime: ReturnType<typeof createStackPlayerRuntime>;
  readonly runtimeState: PlayerRuntimeState;
  readonly preferences: StackPreferences;
  readonly overlaps: readonly (readonly [string, string])[];
  readonly clockWarning: string | null;
};
const PlayerContext = createContext<StackPlayerContext | null>(null);

/** Keeps one player alive across routes, with a fresh lifetime for each account. */
export function PlayerProvider(props: { readonly children: ReactNode }) {
  const { state } = useAppStore();
  return (
    <AccountPlayerProvider key={state.accountId ?? "local"}>{props.children}</AccountPlayerProvider>
  );
}

function AccountPlayerProvider(props: { readonly children: ReactNode }) {
  const store = useAppStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const generation = useRef(0);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [selectedId, select] = useState<string | null>(null);
  const [clockWarning, setClockWarning] = useState<string | null>(null);
  const runtimeRef = useRef<ReturnType<typeof createStackPlayerRuntime> | null>(null);
  const dailyRef = useRef<ReturnType<typeof createDailyStack> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createStackPlayerRuntime({
      read: () => storeRef.current.state.folded,
      execute: (commands) => storeRef.current.executeLocalCommands(commands),
      deviceId: () => storeRef.current.state.deviceId,
      generation: () => generation.current,
      now: () => new Date().toISOString(),
      newId: randomUUID,
      reminders: createReminderAdapter(),
    });
  }
  if (!dailyRef.current)
    dailyRef.current = createDailyStack((commands) =>
      storeRef.current.executeLocalCommands(commands),
    );
  const runtime = runtimeRef.current;
  const runtimeState = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const folded = store.state.folded;
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const date = localPlanningDay(new Date(now), deviceTimezone);
  const dayId = stackDayId(date, deviceTimezone);
  const timezone = folded.days.get(dayId)?.timezone ?? deviceTimezone;
  const entries = selectDayEntries(folded.dayEntries, dayId);
  const intervals = [...folded.workIntervals.values()];
  const activeInterval = intervals.find((interval) => interval.endedAt === null);
  const active = activeInterval ? folded.dayEntries.get(activeInterval.entryId) : undefined;
  const recentInterval = intervals
    .filter((interval) => interval.dayId === dayId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((interval) => folded.dayEntries.get(interval.entryId)?.status === "pending");
  const selectionId = selectedId ?? recentInterval?.entryId;
  const selection = selectionId ? folded.dayEntries.get(selectionId) : undefined;
  const selected =
    active ?? (selection?.status === "pending" ? selection : undefined) ?? entries[0];
  const preferences = folded.stackPreferences.get("default") ?? defaultStackPreferences;
  const overlaps = findIntervalOverlaps(intervals, now);

  useEffect(() => {
    let wall = Date.now();
    let monotonic = performance.now();
    function tick() {
      const nextWall = Date.now();
      const nextMonotonic = performance.now();
      if (Math.abs(nextWall - wall - (nextMonotonic - monotonic)) > 120_000) {
        setClockWarning("The device clock changed. Review recorded time before continuing.");
      }
      wall = nextWall;
      monotonic = nextMonotonic;
      setNow(new Date(nextWall).toISOString());
    }
    const timer = setInterval(tick, 1000);
    const subscription = NativeAppState.addEventListener("change", (status) => {
      if (status === "active") {
        tick();
        void runtime.reconcile();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      generation.current += 1;
      runtime.reset();
    };
  }, [runtime]);

  useEffect(() => {
    void runtime.reconcile();
  }, [folded, runtime]);

  const value: StackPlayerContext = {
    state: store.state,
    now,
    timezone,
    date,
    dayId,
    entries,
    active,
    selected,
    select,
    daily: dailyRef.current,
    runtime,
    runtimeState,
    preferences,
    overlaps,
    clockWarning,
  };
  return (
    <PlayerContext.Provider value={value}>
      <AmbientMedia preferences={preferences} />
      {props.children}
    </PlayerContext.Provider>
  );
}

export function useStackPlayer(): StackPlayerContext {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("PlayerProvider is missing");
  return context;
}
