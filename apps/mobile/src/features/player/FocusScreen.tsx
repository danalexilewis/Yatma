import { Ionicons } from "@expo/vector-icons";
import { deriveEntryTime, forecastDay, nextBreakThreshold, type DayEntry } from "@yatma/core";
import { Link, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TaskMetadata } from "../task/TaskMetadata";
import { useTaskNavigation } from "../task/useTaskNavigation";
import { createTheme, useTheme } from "../../theme/theme";
import { IconButton } from "../../ui";
import { useDesktopLayout } from "../../ui/useDesktopLayout";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { useWorkspaceMenu } from "../../ui/WorkspaceShell";
import { EntryDetailsDialog } from "./EntryDetailsDialog";
import { useStackPlayer } from "./PlayerProvider";
import { SceneBackdrop, SceneControls } from "./Scenes";
import { formatDuration } from "./time";

/** Desktop pairs the stack with ambience; mobile reveals the stack below a full-screen scene. */
export function FocusScreen() {
  const player = useStackPlayer();
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useTaskNavigation();
  const openMenu = useWorkspaceMenu();
  const reducedMotion = useReducedMotion();
  const [scenesOpen, setScenesOpen] = useState(false);
  const [editing, setEditing] = useState<DayEntry | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(height);
  const focusReveal = useRef(new Animated.Value(0)).current;
  const sceneSlide = useRef(new Animated.Value(360)).current;
  const sceneClose = useRef<ComponentRef<typeof View>>(null);
  const sceneTrigger = useRef<ComponentRef<typeof View>>(null);
  const mobileStack = useRef<ComponentRef<typeof ScrollView>>(null);
  const controlColors = desktop ? theme.colors : createTheme("dark").colors;
  const sceneHeight = Math.min(height, viewportHeight);
  const compactControls = !desktop && sceneHeight < 600;
  const entry = player.selected?.status === "pending" ? player.selected : player.entries[0];
  const remaining = player.entries.filter((item) => item.id !== entry?.id);
  const sequence = entry ? [entry, ...remaining] : remaining;
  const intervals = [...player.state.folded.workIntervals.values()];
  const time = entry ? deriveEntryTime(entry, intervals, player.now) : undefined;
  const task = entry?.taskId ? player.state.folded.tasks.get(entry.taskId) : undefined;
  const forecast = forecastDay(sequence, intervals, player.now);
  const secondsLeft = forecast.reduce((total, row) => total + row.remainingSeconds, 0);
  const end = forecast.at(-1)?.endsAt;
  const progress =
    entry && time ? Math.min(1, time.actualSeconds / (entry.allocationMinutes * 60)) : 0;
  const activeInterval = intervals.find(
    (interval) => interval.entryId === entry?.id && interval.endedAt === null,
  );
  const remote = activeInterval && activeInterval.deviceId !== player.state.deviceId;
  const day = entry ? player.state.folded.days.get(entry.dayId) : undefined;
  const breakThreshold =
    entry && day && entry.kind !== "break"
      ? nextBreakThreshold(
          [...player.state.folded.dayEntries.values()].filter((item) => item.dayId === day.id),
          intervals.filter((item) => item.dayId === day.id),
          day,
          player.preferences,
          player.now,
        )
      : null;

  function leaveFocus() {
    router.dismissTo("/today");
  }
  function openEntry(item: DayEntry) {
    if (item.taskId) navigation.openTask(item.taskId);
    else setEditing(item);
  }
  function closeScenes() {
    setScenesOpen(false);
    requestAnimationFrame(() => sceneTrigger.current?.focus());
  }
  useEffect(() => {
    let current = true;
    void player.daily.ensureToday(player.date, player.timezone).catch((cause: unknown) => {
      if (current)
        setPreparationError(
          cause instanceof Error
            ? cause.message
            : "Could not prepare your stack. Open Today to retry.",
        );
    });
    return () => {
      current = false;
    };
  }, [player.daily, player.date, player.timezone]);
  useEffect(() => {
    const animation = Animated.timing(focusReveal, {
      toValue: 1,
      duration: reducedMotion ? 0 : 380,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [focusReveal, reducedMotion]);
  useEffect(() => {
    if (!scenesOpen) return;
    sceneSlide.setValue(reducedMotion ? 0 : 360);
    const animation = Animated.timing(sceneSlide, {
      toValue: 0,
      duration: reducedMotion ? 0 : 280,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [scenesOpen, reducedMotion, sceneSlide]);
  useEffect(() => {
    if (Platform.OS !== "web" || pathname !== "/focus") return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (scenesOpen) {
        event.preventDefault();
        closeScenes();
      } else if (!editing && !document.querySelector('[role="dialog"]')) leaveFocus();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [pathname, scenesOpen, editing]);

  const currentControls = (
    <>
      {entry && time ? (
        <View
          style={{
            paddingHorizontal: desktop ? 28 : 24,
            paddingBottom: desktop ? 20 : 12,
            gap: desktop ? 12 : 6,
          }}
        >
          <Text
            style={{
              color: time.overtimeSeconds ? controlColors.danger : controlColors.ink,
              fontSize: desktop ? 76 : compactControls ? 40 : 46,
              fontWeight: "600",
              letterSpacing: -3,
              fontVariant: ["tabular-nums"],
              textAlign: "center",
            }}
          >
            {time.overtimeSeconds > 0
              ? `+${formatDuration(time.overtimeSeconds)}`
              : formatDuration(time.remainingSeconds)}
          </Text>
          <Pressable
            accessibilityRole={entry.taskId ? "link" : "button"}
            accessibilityLabel={`Open details: ${task?.title ?? entry.title}`}
            onPress={() => openEntry(entry)}
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <Text
              numberOfLines={2}
              style={{
                color: controlColors.ink,
                fontSize: 17,
                fontWeight: "600",
                textAlign: "center",
                flexShrink: 1,
              }}
            >
              {task?.title ?? entry.title}
            </Text>
            <Ionicons name="open-outline" size={14} color={controlColors.muted} />
          </Pressable>
          <View
            style={{
              height: 5,
              borderRadius: 3,
              backgroundColor: controlColors.line,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                backgroundColor: time.overtimeSeconds ? controlColors.danger : controlColors.pine,
              }}
            />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <TaskMetadata task={task} entry={entry} color={controlColors.muted} />
            <Text style={{ color: controlColors.muted, fontSize: 12 }}>
              {formatDuration(entry.allocationMinutes * 60)} allocated
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 6,
            }}
          >
            <IconButton
              name="remove-outline"
              color={controlColors.ink}
              accessibilityLabel="Reduce allocation by 5 minutes"
              disabled={player.runtimeState.pending || entry.allocationMinutes <= 1}
              onPress={() => {
                void player.runtime.execute([
                  {
                    type: "day.update",
                    entryId: entry.id,
                    set: { allocationMinutes: Math.max(1, entry.allocationMinutes - 5) },
                  },
                ]);
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={time.running ? "Pause current task" : "Play current task"}
              disabled={player.runtimeState.pending || !!remote}
              onPress={() => {
                void (time.running
                  ? player.runtime.pause(entry.id)
                  : player.runtime.play(entry.id));
              }}
              style={{
                width: desktop ? 64 : 56,
                height: desktop ? 64 : 56,
                borderRadius: 32,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: controlColors.pine,
                opacity: player.runtimeState.pending || remote ? 0.5 : 1,
              }}
            >
              <Ionicons
                name={time.running ? "pause" : "play"}
                size={28}
                color={controlColors.onPine}
              />
            </Pressable>
            <IconButton
              name="add-outline"
              color={controlColors.ink}
              accessibilityLabel="Extend allocation by 5 minutes"
              disabled={player.runtimeState.pending || entry.allocationMinutes > 1435}
              onPress={() => {
                void player.runtime.extend(entry.id, 5);
              }}
            />
            <IconButton
              name="checkmark-circle-outline"
              color={controlColors.ink}
              accessibilityLabel="Finish current task"
              disabled={player.runtimeState.pending}
              size={30}
              onPress={() => {
                void player.runtime.finish(entry.id);
              }}
            />
          </View>
          {remote ? (
            <Text style={{ color: controlColors.muted, fontSize: 12 }}>
              Running on another device.
            </Text>
          ) : null}
          {time.needsClockReview || player.clockWarning || player.overlaps.length ? (
            <Link href="/today" style={{ color: controlColors.danger, fontSize: 12 }}>
              Review recorded time in Today
            </Link>
          ) : null}
          {breakThreshold !== null ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void player.runtime.takeBreak(entry.id);
                }}
                style={{ paddingVertical: 10 }}
              >
                <Text style={{ color: controlColors.pine, fontSize: 12 }}>
                  Take a {player.preferences.breakMinutes} min break
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void player.runtime.execute([
                    {
                      type: "player.dismissBreak",
                      dayId: entry.dayId,
                      threshold: breakThreshold,
                    },
                  ]);
                }}
                style={{ padding: 10 }}
              >
                <Text style={{ color: controlColors.muted, fontSize: 12 }}>Later</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ padding: 28, gap: 12 }}>
          <Text style={{ color: controlColors.ink, fontSize: 26 }}>Your stack is clear.</Text>
          <Link href="/today" style={{ color: controlColors.pine }}>
            Plan something for Today
          </Link>
        </View>
      )}
      {player.runtimeState.error || preparationError ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: controlColors.danger,
            paddingHorizontal: 24,
            paddingBottom: 12,
            fontSize: 12,
          }}
        >
          {player.runtimeState.error ?? preparationError}
        </Text>
      ) : null}
    </>
  );
  const queueHeading = (
    <View
      style={{
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.line,
        flexDirection: "row",
        justifyContent: "space-between",
      }}
    >
      <Text
        style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1 }}
      >
        UP NEXT
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{remaining.length} items</Text>
    </View>
  );
  const queueRows = (
    <>
      {remaining.map((item) => (
        <FocusQueueRow key={item.id} entry={item} onOpen={() => openEntry(item)} />
      ))}
      {!remaining.length ? (
        <Text style={{ color: theme.colors.muted, padding: 12, lineHeight: 22 }}>
          Nothing queued after this. Finish at your own pace.
        </Text>
      ) : null}{" "}
    </>
  );
  const dayForecast = (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.line,
        paddingHorizontal: 22,
        paddingVertical: 14,
        flexDirection: "row",
        justifyContent: "space-between",
      }}
    >
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
        End{" "}
        {end ? new Date(end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
      </Text>
      <Text style={{ color: theme.colors.ink, fontSize: 12, fontVariant: ["tabular-nums"] }}>
        {formatDuration(secondsLeft)} remaining
      </Text>
    </View>
  );

  return (
    <View
      onLayout={(event) => {
        if (event.nativeEvent.layout.height > 0) setViewportHeight(event.nativeEvent.layout.height);
      }}
      style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.canvas }}
    >
      {desktop ? (
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
          <Animated.View
            style={{
              width: "33.333%",
              minWidth: 320,
              minHeight: 0,
              backgroundColor: theme.colors.canvas,
              borderRightWidth: 1,
              borderRightColor: theme.colors.line,
              opacity: focusReveal,
              transform: [
                {
                  translateX: focusReveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-24, 0],
                  }),
                },
              ],
            }}
          >
            <View
              style={{
                minHeight: 58 + insets.top,
                paddingTop: insets.top,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave focus and open Today"
                onPress={leaveFocus}
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 8,
                }}
              >
                <Ionicons name="chevron-down-outline" size={18} color={theme.colors.ink} />
                <Text style={{ color: theme.colors.ink, fontSize: 16, fontWeight: "600" }}>
                  Today
                </Text>
              </Pressable>
              {desktop && openMenu ? (
                <IconButton
                  name="menu-outline"
                  accessibilityLabel="Open focus navigation menu"
                  onPress={openMenu}
                  size={20}
                />
              ) : null}
            </View>
            {currentControls}
            {queueHeading}
            <ScrollView
              style={{ flex: 1, minHeight: 0 }}
              contentContainerStyle={{ padding: 16, paddingTop: 4 }}
              keyboardShouldPersistTaps="handled"
              accessibilityLabel="Upcoming focus tasks"
            >
              {queueRows}
            </ScrollView>
            {dayForecast}
          </Animated.View>
          <View
            style={{
              flex: 1,
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <SceneBackdrop scene={player.preferences.scene} />
            <View
              pointerEvents="none"
              style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.08)" }}
            />
            <Pressable
              ref={sceneTrigger}
              accessibilityRole="button"
              accessibilityLabel="Change focus soundscape"
              onPress={() => setScenesOpen(true)}
              style={{
                position: "absolute",
                bottom: 24 + insets.bottom,
                right: 24,
                backgroundColor: "rgba(14,30,25,0.78)",
                paddingHorizontal: 18,
                paddingVertical: 14,
                borderRadius: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 16,
              }}
            >
              <Ionicons name="headset-outline" size={21} color="#E8F0EB" />
              <View style={{ gap: 4 }}>
                <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 14 }}>
                  {player.preferences.scene.charAt(0).toUpperCase() +
                    player.preferences.scene.slice(1)}
                </Text>
                <Text style={{ color: "#C5D5CC", fontSize: 11 }}>
                  {player.preferences.muted ? "Muted · choose a soundscape" : "Continuous ambience"}
                </Text>
              </View>
              <Ionicons name="options-outline" size={19} color="#E8F0EB" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={mobileStack}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Focus scene and task stack"
          >
            <StatusBar style="light" />
            <View
              style={{
                height: sceneHeight,
                justifyContent: "space-between",
                backgroundColor: "#14221E",
              }}
            >
              <SceneBackdrop scene={player.preferences.scene} />
              <View
                pointerEvents="none"
                style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.12)" }}
              />
              <View style={{ height: insets.top + 56 }} />
              <Animated.View
                style={{
                  marginLeft: 16 + insets.left,
                  marginRight: 16 + insets.right,
                  marginBottom: insets.bottom + 12,
                  paddingTop: 12,
                  borderRadius: 24,
                  backgroundColor: "rgba(14,26,21,0.88)",
                  opacity: focusReveal,
                  transform: [
                    {
                      translateY: focusReveal.interpolate({
                        inputRange: [0, 1],
                        outputRange: [24, 0],
                      }),
                    },
                  ],
                }}
              >
                {currentControls}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scroll to upcoming task stack"
                  onPress={() =>
                    mobileStack.current?.scrollTo({ y: sceneHeight, animated: !reducedMotion })
                  }
                  style={{
                    minHeight: 44,
                    paddingHorizontal: 24,
                    borderTopWidth: 1,
                    borderTopColor: "rgba(231,238,234,0.14)",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: "#B9CBC2", fontSize: 12 }}>
                    {remaining.length} up next · Scroll to your stack
                  </Text>
                  <Ionicons name="chevron-down-outline" size={16} color="#B9CBC2" />
                </Pressable>
              </Animated.View>
            </View>
            <View style={{ paddingTop: insets.top + 68, paddingBottom: insets.bottom + 16 }}>
              {queueHeading}
              <View
                style={{ padding: 16, paddingTop: 4 }}
                accessibilityLabel="Upcoming focus tasks"
              >
                {queueRows}
              </View>
              {dayForecast}
            </View>
          </ScrollView>
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1,
              paddingTop: insets.top + 12,
              paddingLeft: 16 + insets.left,
              paddingRight: 16 + insets.right,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave focus and open Today"
              onPress={leaveFocus}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                backgroundColor: "rgba(14,30,25,0.74)",
                borderRadius: 22,
              }}
            >
              <Ionicons name="chevron-down-outline" size={18} color="#F0F5F2" />
              <Text style={{ color: "#F0F5F2", fontWeight: "600" }}>Today</Text>
            </Pressable>
            <Pressable
              ref={sceneTrigger}
              accessibilityRole="button"
              accessibilityLabel="Change focus soundscape"
              onPress={() => setScenesOpen(true)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                backgroundColor: "rgba(14,30,25,0.74)",
                borderRadius: 22,
              }}
            >
              <Ionicons name="headset-outline" size={18} color="#F0F5F2" />
              <Text style={{ color: "#F0F5F2", fontWeight: "500" }}>
                {player.preferences.scene.charAt(0).toUpperCase() +
                  player.preferences.scene.slice(1)}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      <Modal
        visible={scenesOpen}
        transparent
        animationType="fade"
        onRequestClose={closeScenes}
        onShow={() => sceneClose.current?.focus()}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.28)", alignItems: "flex-end" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close soundscape chooser"
            onPress={closeScenes}
            style={{ position: "absolute", inset: 0 }}
          />
          <Animated.View
            role="dialog"
            aria-label="Soundscapes"
            style={{
              width: 370,
              maxWidth: "100%",
              height: "100%",
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              backgroundColor: theme.colors.surface,
              transform: [{ translateX: sceneSlide }],
            }}
          >
            <View
              style={{
                minHeight: 64,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: theme.colors.ink, fontSize: 18, fontWeight: "600" }}>
                Your ambience
              </Text>
              <Pressable
                ref={sceneClose}
                accessibilityRole="button"
                accessibilityLabel="Dismiss soundscape chooser"
                onPress={closeScenes}
                style={{ padding: 12 }}
              >
                <Ionicons name="close-outline" size={22} color={theme.colors.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <SceneControls />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
      {editing ? (
        <EntryDetailsDialog
          key={editing.id}
          entry={player.state.folded.dayEntries.get(editing.id) ?? editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function FocusQueueRow(props: { readonly entry: DayEntry; readonly onOpen: () => void }) {
  const player = useStackPlayer();
  const theme = useTheme();
  const task = props.entry.taskId ? player.state.folded.tasks.get(props.entry.taskId) : undefined;
  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.line,
        padding: 12,
        marginBottom: 10,
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
      }}
    >
      <Pressable
        accessibilityRole={props.entry.taskId ? "link" : "button"}
        accessibilityLabel={`Open details: ${task?.title ?? props.entry.title}`}
        onPress={props.onOpen}
        style={{ flex: 1, gap: 8, minHeight: 48, justifyContent: "center" }}
      >
        <Text
          numberOfLines={2}
          style={{ color: theme.colors.ink, fontSize: 14, fontWeight: "600", lineHeight: 20 }}
        >
          {props.entry.kind === "break" ? "☕ " : ""}
          {task?.title ?? props.entry.title}
        </Text>
        <TaskMetadata task={task} entry={props.entry} />
      </Pressable>
      <IconButton
        name="play-circle-outline"
        size={26}
        accessibilityLabel={`Start ${task?.title ?? props.entry.title}`}
        disabled={player.runtimeState.pending}
        onPress={() => {
          player.select(props.entry.id);
          void player.runtime.play(props.entry.id);
        }}
      />
    </View>
  );
}
