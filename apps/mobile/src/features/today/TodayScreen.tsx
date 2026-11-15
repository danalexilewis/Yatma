import { Ionicons } from "@expo/vector-icons";
import {
  addCalendarDays,
  deriveEntryTime,
  selectDayEntries,
  type DayEntry,
  type WorkInterval,
} from "@yatma/core";
import { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { Link, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { DragEndParams, RenderItemParams } from "react-native-draggable-flatlist";

import { useStackPlayer } from "../player/PlayerProvider";
import { Action } from "./TodayControls";
import { dayMoveFromDrop } from "./reorder";
import { TodayList } from "./TodayList";
import { TodayEntryRow } from "./TodayEntryRow";
import { useTheme } from "../../theme/theme";
import { Screen, ScreenHeader } from "../../ui";
import { formatDuration } from "../player/time";

/** Today's independently ordered plan, routine assembly, editable allocations and actual history. */
export function TodayScreen() {
  const player = useStackPlayer();
  const router = useRouter();
  const theme = useTheme();
  const { state, date, timezone, dayId, daily, runtime, runtimeState, entries } = player;
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [activityTitle, setActivityTitle] = useState("");
  const [activityMinutes, setActivityMinutes] = useState("15");
  const intervals = [...state.folded.workIntervals.values()];
  const history = selectDayEntries(state.folded.dayEntries, dayId, true).filter(
    (entry) => entry.status !== "pending",
  );
  const tomorrowDate = addCalendarDays(date, 1);
  const tomorrowEntries = [...state.folded.days.values()]
    .filter((day) => day.date === tomorrowDate)
    .flatMap((day) => selectDayEntries(state.folded.dayEntries, day.id));

  useEffect(() => {
    if (!state.ready) return;
    let current = true;
    void daily.ensureToday(date, timezone, true).catch((cause: unknown) => {
      if (current)
        setError(cause instanceof Error ? cause.message : "Could not prepare today. Try Reload.");
    });
    return () => {
      current = false;
    };
  }, [state.ready, state.accountId, date, timezone, daily]);

  async function refresh() {
    setError(null);
    try {
      await daily.ensureToday(date, timezone, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh today.");
    }
  }
  async function addActivity(kind: "activity" | "break") {
    const title = kind === "break" ? "Break" : activityTitle.trim();
    const minutes = kind === "break" ? player.preferences.breakMinutes : Number(activityMinutes);
    if (!title) {
      setError("Give the activity a title.");
      return;
    }
    if (!(minutes > 0 && minutes <= 1440)) {
      setError("Choose between 1 and 1440 minutes.");
      return;
    }
    const saved = await runtime.execute([
      {
        type: "day.add",
        dayId,
        kind,
        title,
        allocationMinutes: minutes,
        entryId: randomUUID(),
      },
    ]);
    if (saved && kind === "activity") setActivityTitle("");
  }
  function moveEntry(entry: DayEntry, direction: "up" | "down") {
    const index = entries.findIndex((item) => item.id === entry.id);
    const before = direction === "up" ? entries[index - 1]?.id : (entries[index + 2]?.id ?? null);
    if (before === undefined) return;
    void runtime.execute([{ type: "day.move", entryId: entry.id, beforeEntryId: before }]);
  }
  function reorder({ data, from, to }: DragEndParams<DayEntry>) {
    if (runtimeState.pending) return;
    const command = dayMoveFromDrop(data, from, to);
    if (command) void runtime.execute([command]);
  }
  function renderEntry({ item, drag, isActive }: RenderItemParams<DayEntry>) {
    const index = entries.findIndex((entry) => entry.id === item.id);
    return (
      <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
        <TodayEntryRow
          entry={item}
          focused={focusedEntryId === item.id}
          onFocusRow={() => setFocusedEntryId(item.id)}
          drag={drag}
          dragging={isActive}
          moveUp={index > 0 ? () => moveEntry(item, "up") : undefined}
          moveDown={index < entries.length - 1 ? () => moveEntry(item, "down") : undefined}
        />
      </View>
    );
  }
  return (
    <Screen>
      <View style={styles.column}>
        <ScreenHeader
          title="Today"
          trailing={
            <Link href="/focus" asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open focus mode"
                style={{
                  ...styles.button,
                  backgroundColor: theme.colors.pine,
                  flexDirection: "row",
                  gap: 8,
                  paddingHorizontal: 18,
                }}
              >
                <Ionicons name="expand-outline" size={18} color={theme.colors.onPine} />
                <Text style={{ color: theme.colors.onPine, fontWeight: "700" }}>Focus</Text>
              </Pressable>
            </Link>
          }
        />
      </View>
      <TodayList
        data={[...entries]}
        keyExtractor={(entry) => entry.id}
        renderItem={renderEntry}
        onDragEnd={reorder}
        disabled={runtimeState.pending}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 28 }}
        ListHeaderComponent={
          <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
            <Text style={{ color: theme.colors.muted, marginBottom: 16 }}>
              {date} · {timezone}
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                {error}
              </Text>
            ) : null}
            {runtimeState.error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                {runtimeState.error}
              </Text>
            ) : null}
            {player.overlaps.length ? (
              <Text
                accessibilityRole="alert"
                style={{ color: theme.colors.danger, marginVertical: 8 }}
              >
                Overlapping runs were recorded on different devices. Review the intervals below;
                their overlap is not silently added twice.
              </Text>
            ) : null}
            {player.clockWarning ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                {player.clockWarning}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Action label="Choose tasks" onPress={() => router.push("/tasks")} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showOptions }}
                onPress={() => setShowOptions(!showOptions)}
                style={styles.button}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  {showOptions ? "Fewer options" : "More options"}
                </Text>
              </Pressable>
            </View>
            {showOptions ? (
              <View style={styles.actions}>
                <Action
                  label="Reload today's plan"
                  onPress={() => void refresh()}
                  disabled={runtimeState.pending}
                />
                <Action
                  label="Insert break"
                  onPress={() => void addActivity("break")}
                  disabled={runtimeState.pending}
                />
                <Action label="Routines" onPress={() => router.push("/routines")} />
                <Text style={{ color: theme.colors.muted, marginBottom: 8 }}>
                  Drag the handle to reorder, or focus it and use the arrow keys.
                </Text>
              </View>
            ) : null}
            <Text style={[styles.heading, { color: theme.colors.ink, marginTop: 16 }]}>
              Your stack · {entries.length}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
            {tomorrowEntries.length ? (
              <TomorrowPreview key={tomorrowDate} date={tomorrowDate} entries={tomorrowEntries} />
            ) : null}
            <View style={styles.section}>
              <Text style={[styles.heading, { color: theme.colors.ink }]}>Add an activity</Text>
              <TextInput
                accessibilityLabel="Activity title"
                value={activityTitle}
                onChangeText={setActivityTitle}
                placeholder="Activity title"
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
              />
              <TextInput
                accessibilityLabel="Activity duration in minutes"
                value={activityMinutes}
                onChangeText={setActivityMinutes}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
              />
              <Action
                label="Add activity"
                onPress={() => void addActivity("activity")}
                disabled={runtimeState.pending}
              />
            </View>
            <Action
              label={showHistory ? "Hide time & day history" : "Time & day history"}
              onPress={() => setShowHistory(!showHistory)}
            />
            {showHistory ? (
              <View style={styles.section}>
                {history.map((entry) => (
                  <View key={entry.id} style={{ paddingVertical: 8 }}>
                    <Text style={{ color: theme.colors.ink }}>
                      {entry.taskId
                        ? (state.folded.tasks.get(entry.taskId)?.title ?? entry.title)
                        : entry.title}{" "}
                      · {entry.status}
                    </Text>
                    <Text style={{ color: theme.colors.muted }}>
                      {deriveEntryTime(entry, intervals, player.now).actualSeconds >= 1
                        ? `${formatDuration(deriveEntryTime(entry, intervals, player.now).actualSeconds)} worked · `
                        : ""}
                      {entry.allocationMinutes} min planned
                    </Text>
                    {entry.taskId ? (
                      <Link href={`/task/${entry.taskId}`} style={{ color: theme.colors.pine }}>
                        Open task
                      </Link>
                    ) : null}
                  </View>
                ))}
                {intervals
                  .filter((interval) => interval.dayId === dayId)
                  .map((interval) => (
                    <IntervalRow key={interval.id} interval={interval} />
                  ))}
                {!history.length && !intervals.some((interval) => interval.dayId === dayId) ? (
                  <Text style={{ color: theme.colors.muted }}>
                    No time or completed entries yet.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}

/** Read-only committed destination for Tomorrow transfers, including carried work order. */
function TomorrowPreview(props: { readonly date: string; readonly entries: readonly DayEntry[] }) {
  const player = useStackPlayer();
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const preparation = props.entries.filter((entry) => entry.preparation);
  const work = props.entries.filter((entry) => !entry.preparation);
  const carried = work.filter((entry) => entry.carryOrder !== null);
  const visibleWork = showAll ? work : work.slice(0, 5);
  function title(entry: DayEntry) {
    return entry.taskId
      ? (player.state.folded.tasks.get(entry.taskId)?.title ?? entry.title)
      : entry.title;
  }
  return (
    <View
      style={[
        styles.section,
        { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.line },
      ]}
    >
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={[styles.heading, { color: theme.colors.ink }]}
      >
        Tomorrow commitments · {props.date}
      </Text>
      {preparation.length ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
            Preparation before work
          </Text>
          {preparation.map((entry) => (
            <Text key={entry.id} style={{ color: theme.colors.muted }}>
              {title(entry)} · {entry.allocationMinutes} min
            </Text>
          ))}
        </View>
      ) : null}
      {visibleWork.map((entry, index) => (
        <View key={entry.id} style={styles.backlogRow}>
          <Text style={{ color: theme.colors.muted, width: 22 }}>{index + 1}.</Text>
          <View style={{ flex: 1, gap: 3 }}>
            {entry.taskId ? (
              <Link
                href={`/task/${entry.taskId}`}
                style={{ color: theme.colors.pine, fontWeight: "600", paddingVertical: 4 }}
              >
                {title(entry)}
              </Link>
            ) : (
              <Text style={{ color: theme.colors.ink }}>{title(entry)}</Text>
            )}
            <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
              {formatDuration(entry.allocationMinutes * 60)} planned
              {entry.carryOrder !== null
                ? ` · Carried commitment ${carried.findIndex((item) => item.id === entry.id) + 1}`
                : entry.kind === "break"
                  ? " · Break"
                  : " · Planned work"}
            </Text>
          </View>
        </View>
      ))}
      {work.length > 5 ? (
        <Action
          label={
            showAll ? "Show fewer tomorrow entries" : `Show all ${work.length} tomorrow entries`
          }
          onPress={() => setShowAll(!showAll)}
        />
      ) : null}
    </View>
  );
}

function IntervalRow(props: { readonly interval: WorkInterval }) {
  const player = useStackPlayer();
  const theme = useTheme();
  const interval = props.interval;
  const entry = player.state.folded.dayEntries.get(interval.entryId);
  const seconds =
    interval.correctedSeconds ??
    Math.max(
      0,
      (Date.parse(interval.endedAt ?? player.now) - Date.parse(interval.startedAt)) / 1000,
    );
  const [correction, setCorrection] = useState("");
  const amount = Number(correction);
  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.line,
      }}
    >
      <Text style={{ color: theme.colors.ink }}>
        {entry?.title ?? "Recorded interval"} · {formatDuration(seconds)}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
        {new Date(interval.startedAt).toLocaleTimeString()} →{" "}
        {interval.endedAt ? new Date(interval.endedAt).toLocaleTimeString() : "still running"} ·{" "}
        {interval.deviceId}
      </Text>
      {interval.endedAt ? (
        <View style={styles.actions}>
          <TextInput
            accessibilityLabel={`Correct actual minutes for ${entry?.title ?? "interval"}`}
            value={correction}
            onChangeText={setCorrection}
            placeholder="Correct actual minutes"
            placeholderTextColor={theme.colors.muted}
            keyboardType="decimal-pad"
            style={[
              styles.input,
              { color: theme.colors.ink, borderColor: theme.colors.line, flex: 1 },
            ]}
          />
          <Action
            label="Save correction"
            disabled={
              !correction.trim() ||
              !Number.isFinite(amount) ||
              amount < 0 ||
              player.runtimeState.pending
            }
            onPress={() => {
              void player.runtime.execute([
                { type: "player.correct", intervalId: interval.id, seconds: amount * 60 },
              ]);
            }}
          />
        </View>
      ) : (
        <Action
          label="Pause to correct time"
          onPress={() => {
            void player.runtime.pause(interval.entryId);
          }}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  column: { width: "100%", maxWidth: 760, alignSelf: "center" },
  heading: { fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 8 },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  section: { gap: 8, paddingVertical: 12 },
  backlogRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
  },
});
