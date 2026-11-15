import { Ionicons } from "@expo/vector-icons";
import { deriveEntryTime, type DayEntry } from "@yatma/core";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { EntryDetailsDialog } from "../player/EntryDetailsDialog";
import { useStackPlayer } from "../player/PlayerProvider";
import { formatDuration } from "../player/time";
import { TaskMetadata } from "../task/TaskMetadata";
import { useTaskNavigation } from "../task/useTaskNavigation";
import { useTheme } from "../../theme/theme";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { useDesktopLayout } from "../../ui/useDesktopLayout";
import { IconButton } from "../../ui";

/** Compact daily rows keep one-tap actions together and task details in a dialog. */
export function TodayEntryRow(props: {
  readonly entry: DayEntry;
  readonly focused?: boolean;
  readonly onFocusRow?: () => void;
  readonly drag: () => void;
  readonly dragging: boolean;
  readonly moveUp?: () => void;
  readonly moveDown?: () => void;
}) {
  const player = useStackPlayer();
  const theme = useTheme();
  const navigation = useTaskNavigation();
  const router = useRouter();
  const desktop = useDesktopLayout();
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const reducedMotion = useReducedMotion();
  const actionsVisible = desktop ? hovered || keyboardFocused : !!props.focused;
  const [actionsMounted, setActionsMounted] = useState(actionsVisible);
  const actionsOpacity = useRef(new Animated.Value(actionsVisible ? 1 : 0)).current;
  useEffect(() => {
    if (actionsVisible) setActionsMounted(true);
    const animation = Animated.timing(actionsOpacity, {
      toValue: actionsVisible ? 1 : 0,
      duration: reducedMotion ? 0 : 160,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start(({ finished }) => {
      if (finished && !actionsVisible) setActionsMounted(false);
    });
    return () => animation.stop();
  }, [actionsVisible, actionsOpacity, reducedMotion]);
  const { entry } = props;
  const task = entry.taskId ? player.state.folded.tasks.get(entry.taskId) : undefined;
  const title = task?.title ?? entry.title;
  const intervals = [...player.state.folded.workIntervals.values()];
  const time = deriveEntryTime(entry, intervals, player.now);
  const current = player.selected?.id === entry.id;
  const disabled = player.runtimeState.pending || props.dragging;
  const remote = intervals.some(
    (interval) =>
      interval.entryId === entry.id &&
      interval.endedAt === null &&
      interval.deviceId !== player.state.deviceId,
  );

  function openDetails() {
    if (entry.taskId) navigation.openTask(entry.taskId);
    else setEditing(true);
  }

  return (
    <Pressable
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setKeyboardFocused(true)}
      onBlur={() => setKeyboardFocused(false)}
      onPress={desktop ? undefined : props.onFocusRow}
      style={[
        styles.entry,
        {
          backgroundColor: props.dragging || current ? theme.colors.pineSoft : theme.colors.surface,
          borderColor: props.dragging ? theme.colors.pine : theme.colors.line,
          opacity: props.dragging ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder ${title}`}
          accessibilityHint="Drag to reorder, or use the up and down arrow keys"
          accessibilityState={{ disabled: player.runtimeState.pending }}
          accessibilityActions={[
            ...(props.moveUp ? [{ name: "increment" as const, label: "Move up" }] : []),
            ...(props.moveDown ? [{ name: "decrement" as const, label: "Move down" }] : []),
          ]}
          onAccessibilityAction={(event) => {
            if (disabled) return;
            if (event.nativeEvent.actionName === "increment") props.moveUp?.();
            if (event.nativeEvent.actionName === "decrement") props.moveDown?.();
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.nativeEvent.key === "ArrowUp" && props.moveUp) {
              event.preventDefault();
              props.moveUp();
            }
            if (event.nativeEvent.key === "ArrowDown" && props.moveDown) {
              event.preventDefault();
              props.moveDown();
            }
          }}
          {...(Platform.OS === "web" ? { delayPressIn: 0 } : {})}
          onPressIn={props.drag}
          disabled={player.runtimeState.pending}
          style={styles.handle}
        >
          <Ionicons name="reorder-two-outline" size={22} color={theme.colors.muted} />
        </Pressable>
        <Pressable
          accessibilityRole={entry.taskId ? "link" : "button"}
          accessibilityLabel={`Open details: ${title}`}
          delayLongPress={250}
          onLongPress={disabled ? undefined : props.drag}
          disabled={props.dragging}
          onPress={desktop ? openDetails : props.onFocusRow}
          style={styles.copy}
        >
          <Text
            selectable={false}
            style={{
              color: theme.colors.ink,
              fontSize: theme.type.row,
              fontWeight: "600",
              lineHeight: 24,
            }}
          >
            {title}
          </Text>
          <TaskMetadata task={task} entry={entry} />
          {current ? (
            <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 3 }}>
              {time.running ? "Playing" : "Current"} ·{" "}
              {time.overtimeSeconds > 0
                ? `+${formatDuration(time.overtimeSeconds)} over`
                : `${formatDuration(time.remainingSeconds)} remaining`}
              {remote ? " · Running on another device" : ""}
            </Text>
          ) : null}
        </Pressable>
        {actionsMounted ? (
          <Animated.View
            pointerEvents={actionsVisible ? "auto" : "none"}
            aria-hidden={!actionsVisible}
            accessibilityElementsHidden={!actionsVisible}
            importantForAccessibility={actionsVisible ? "auto" : "no-hide-descendants"}
            style={[styles.actions, { opacity: actionsOpacity }]}
          >
            <IconButton
              name={time.running ? "pause-outline" : "play-outline"}
              tooltip={time.running ? "Pause" : "Play"}
              accessibilityLabel={`${time.running ? "Pause" : "Start"} ${title}`}
              color={theme.colors.pine}
              disabled={disabled || remote}
              onPress={() => {
                player.select(entry.id);
                void (time.running
                  ? player.runtime.pause(entry.id)
                  : player.runtime.play(entry.id));
              }}
            />
            {current ? (
              <>
                <IconButton
                  name="checkmark-circle-outline"
                  tooltip="Finish"
                  accessibilityLabel={`Finish ${title}`}
                  disabled={disabled}
                  onPress={() => void player.runtime.finish(entry.id)}
                />
                <IconButton
                  name="expand-outline"
                  tooltip="Focus"
                  accessibilityLabel={`Focus on ${title}`}
                  disabled={disabled}
                  onPress={() => router.push("/focus")}
                />
              </>
            ) : null}
            <IconButton
              name="play-skip-forward-outline"
              tooltip="Later"
              accessibilityLabel={`Later: ${title}${time.remainingSeconds === 0 ? `, add ${player.preferences.defaultAllocationMinutes} minutes` : ""}`}
              disabled={disabled}
              onPress={() =>
                void player.runtime.later(
                  entry.id,
                  time.remainingSeconds === 0
                    ? player.preferences.defaultAllocationMinutes
                    : undefined,
                )
              }
            />
            <IconButton
              name="calendar-outline"
              tooltip="Tomorrow"
              accessibilityLabel={`Tomorrow: ${title}${time.remainingSeconds === 0 ? `, add ${player.preferences.defaultAllocationMinutes} minutes` : ""}`}
              disabled={disabled}
              onPress={() =>
                void player.runtime.tomorrow(
                  entry.id,
                  time.remainingSeconds === 0
                    ? player.preferences.defaultAllocationMinutes
                    : undefined,
                )
              }
            />
            <IconButton
              name="close-outline"
              tooltip={entry.kind === "break" ? "Skip break" : "Remove from Today"}
              accessibilityLabel={`${entry.kind === "break" ? "Skip break" : "Remove from Today"}: ${title}`}
              disabled={disabled}
              onPress={() =>
                void player.runtime.execute([{ type: "day.remove", entryId: entry.id }])
              }
            />
            <IconButton
              name="open-outline"
              tooltip="Open details"
              accessibilityLabel={`Open ${title}`}
              disabled={props.dragging}
              onPress={openDetails}
            />
          </Animated.View>
        ) : null}
      </View>
      {editing ? <EntryDetailsDialog entry={entry} onClose={() => setEditing(false)} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entry: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 6, marginVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  handle: { width: 44, minHeight: 48, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 120, minHeight: 48, justifyContent: "center", paddingVertical: 6 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    marginLeft: "auto",
  },
});
