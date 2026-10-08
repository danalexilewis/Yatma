import type { Task, TaskId } from "@yatma/core";
import { TaskId as TaskIdSchema } from "@yatma/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Swipeable, {
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Sortable, { type SortableFlexDragEndParams } from "react-native-sortables";

import { CaptureSheet } from "../capture/CaptureSheet";
import {
  consumeCaptureOpen,
  subscribeCaptureOpen,
} from "../capture/captureIntent";
import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectDoingTasks, selectNowTasks } from "../../state/selectors";
import { quadrantColor, useTheme } from "../../theme/theme";
import { Composer, EmptyState, IconButton, Screen, ScreenHeader } from "../../ui";

/** Global priority list with Doing filter, swipe actions, long-press reorder. */
export function NowScreen() {
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const { createTask, updateTask } = useAppStore();
  const allTasks = selectNowTasks(folded);
  const doing = selectDoingTasks(folded);
  const [draft, setDraft] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [showDoingOnly, setShowDoingOnly] = useState(false);

  useEffect(() => {
    function openIfPending() {
      if (consumeCaptureOpen()) setCaptureOpen(true);
    }
    openIfPending();
    return subscribeCaptureOpen(openIfPending);
  }, []);

  const tasks = showDoingOnly ? doing : allTasks;
  const doingProjects = new Set(doing.map((task) => task.projectId ?? "inbox")).size;

  async function onQuickAdd() {
    const title = draft.trim();
    if (!title) return;
    await createTask({ title });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDraft("");
  }

  async function completeTask(taskId: TaskId) {
    await updateTask({ taskId, status: "done" });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function deleteTask(taskId: TaskId) {
    await updateTask({ taskId, deleted: true });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  async function moveTask(taskId: TaskId, placement: "top" | "bottom") {
    await updateTask({ taskId, placement: { kind: placement } });
    void Haptics.selectionAsync();
  }

  function onDragEnd(params: SortableFlexDragEndParams) {
    if (params.fromIndex === params.toIndex) return;
    const reordered = params.order(tasks);
    const moved = reordered[params.toIndex];
    if (!moved) return;
    const before = reordered[params.toIndex - 1];
    const after = reordered[params.toIndex + 1];
    void (async () => {
      if (!before) {
        await updateTask({ taskId: moved.id, placement: { kind: "top" } });
      } else if (!after) {
        await updateTask({ taskId: moved.id, placement: { kind: "bottom" } });
      } else {
        await updateTask({
          taskId: moved.id,
          placement: { kind: "after", taskId: before.id },
        });
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })();
  }

  return (
    <Screen>
      <ScreenHeader
        title="Now"
        trailing={
          <IconButton
            name="settings-outline"
            accessibilityLabel="Settings"
            color={theme.colors.pine}
            onPress={() => router.push("/settings")}
          />
        }
      />

      {doing.length > 0 ? (
        <Pressable
          onPress={() => {
            setShowDoingOnly((value) => !value);
            void Haptics.selectionAsync();
          }}
          style={[
            styles.doingChip,
            {
              backgroundColor: showDoingOnly ? theme.colors.pine : theme.colors.pineSoft,
              marginHorizontal: theme.space.screenX,
            },
          ]}
        >
          <Text
            style={{
              color: showDoingOnly ? theme.colors.onPine : theme.colors.pine,
              fontWeight: "600",
              fontSize: theme.type.meta,
            }}
          >
            {doing.length} in progress
            {doingProjects > 0 ? ` · ${doingProjects} project${doingProjects === 1 ? "" : "s"}` : ""}
            {showDoingOnly ? " · showing" : ""}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {tasks.length === 0 ? (
          <EmptyState
            message={
              showDoingOnly
                ? "Nothing in progress. Tap the filter to show everything."
                : "Inbox zero. Add a task below."
            }
          />
        ) : (
          <Sortable.Flex
            flexDirection="column"
            gap={0}
            dragActivationDelay={220}
            onDragEnd={onDragEnd}
          >
            {tasks.map((task, index) => (
              <NowTaskRow
                key={task.id}
                task={task}
                last={index === tasks.length - 1}
                onOpen={() => router.push(`/task/${task.id}`)}
                onComplete={() => void completeTask(TaskIdSchema.make(task.id))}
                onDelete={() => void deleteTask(TaskIdSchema.make(task.id))}
                onTop={() => void moveTask(TaskIdSchema.make(task.id), "top")}
                onBottom={() => void moveTask(TaskIdSchema.make(task.id), "bottom")}
              />
            ))}
          </Sortable.Flex>
        )}
      </ScrollView>

      <Composer
        value={draft}
        onChangeText={setDraft}
        placeholder="Add a task"
        onSend={() => void onQuickAdd()}
        onMic={() => setCaptureOpen(true)}
        tabBarPad
      />

      <CaptureSheet
        visible={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSend={() => setCaptureOpen(false)}
      />
    </Screen>
  );
}

function NowTaskRow(props: {
  readonly task: Task;
  readonly last: boolean;
  readonly onOpen: () => void;
  readonly onComplete: () => void;
  readonly onDelete: () => void;
  readonly onTop: () => void;
  readonly onBottom: () => void;
}) {
  const theme = useTheme();
  const tick = quadrantColor(theme, props.task.quadrant ?? "inbox");

  function renderLeftActions() {
    return (
      <View style={styles.actionRow}>
        <Pressable
          onPress={props.onComplete}
          style={[styles.actionBtn, { backgroundColor: theme.colors.do }]}
        >
          <Text style={styles.actionLabel}>Done</Text>
        </Pressable>
      </View>
    );
  }

  function renderRightActions() {
    return (
      <View style={styles.actionRow}>
        <Pressable
          onPress={props.onTop}
          style={[styles.actionBtn, { backgroundColor: theme.colors.pine }]}
        >
          <Text style={styles.actionLabel}>Top</Text>
        </Pressable>
        <Pressable
          onPress={props.onBottom}
          style={[styles.actionBtn, { backgroundColor: theme.colors.schedule }]}
        >
          <Text style={styles.actionLabel}>Bottom</Text>
        </Pressable>
        <Pressable
          onPress={props.onDelete}
          style={[styles.actionBtn, { backgroundColor: theme.colors.eliminate }]}
        >
          <Text style={styles.actionLabel}>Delete</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Swipeable
      overshootRight={false}
      overshootLeft={false}
      onSwipeableOpen={(direction) => {
        if (direction === SwipeDirection.LEFT) props.onComplete();
      }}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
    >
      <Pressable
        onPress={props.onOpen}
        style={[
          styles.taskRow,
          {
            minHeight: theme.touch,
            paddingHorizontal: theme.space.screenX,
            borderBottomColor: theme.colors.line,
            borderBottomWidth: props.last ? 0 : StyleSheet.hairlineWidth,
            backgroundColor: theme.colors.canvas,
          },
        ]}
      >
        <Pressable
          onPress={props.onComplete}
          accessibilityLabel="Complete task"
          hitSlop={8}
          style={[styles.circle, { borderColor: theme.colors.line }]}
        />
        <View style={[styles.tick, { backgroundColor: tick }]} />
        <View style={styles.taskBody}>
          <View style={styles.titleRow}>
            {props.task.status === "in_progress" ? (
              <View style={[styles.doingBadge, { backgroundColor: theme.colors.pine }]}>
                <Text style={{ color: theme.colors.onPine, fontSize: 11, fontWeight: "600" }}>
                  Doing
                </Text>
              </View>
            ) : null}
            <Text
              style={{
                flex: 1,
                color: theme.colors.ink,
                fontSize: theme.type.row,
                fontWeight: "500",
              }}
              numberOfLines={2}
            >
              {props.task.title}
            </Text>
          </View>
          <Text
            style={{
              marginTop: 2,
              color: theme.colors.muted,
              fontSize: theme.type.meta,
              textTransform: "capitalize",
            }}
          >
            {props.task.quadrant ?? "Inbox"}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  doingChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  list: { flex: 1 },
  actionRow: { flexDirection: "row", alignItems: "stretch" },
  actionBtn: { justifyContent: "center", paddingHorizontal: 14, minWidth: 64 },
  actionLabel: { color: "#fff", fontWeight: "600", fontSize: 12 },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 10,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
  tick: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
  },
  taskBody: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  doingBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
