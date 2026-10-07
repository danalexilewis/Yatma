import type { Task, TaskId } from "@yatma/core";
import { TaskId as TaskIdSchema } from "@yatma/core";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { colors } from "../../theme/colors";

/** Global priority list with Doing chip, swipe actions, long-press reorder. */
export function NowScreen() {
  const router = useRouter();
  const folded = useFoldedState();
  const { createTask, updateTask } = useAppStore();
  const tasks = selectNowTasks(folded);
  const doing = selectDoingTasks(folded);
  const [quickAdd, setQuickAdd] = useState("");
  const [pullHint, setPullHint] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  useEffect(() => {
    function openIfPending() {
      if (consumeCaptureOpen()) setCaptureOpen(true);
    }
    openIfPending();
    return subscribeCaptureOpen(openIfPending);
  }, []);

  const doingProjects = new Set(doing.map((task) => task.projectId ?? "inbox")).size;

  async function onQuickAdd() {
    const title = quickAdd.trim();
    if (!title) return;
    await createTask({ title });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setQuickAdd("");
    setPullHint(false);
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
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Now</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setCaptureOpen(true)}
            style={[styles.micButton, { backgroundColor: colors.brand }]}
          >
            <Text style={styles.micLabel}>Mic</Text>
          </Pressable>
          <Link href="/settings" asChild>
            <Pressable>
              <Text style={{ color: colors.brand, fontWeight: "600" }}>Settings</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {doing.length > 0 ? (
        <Pressable
          style={[styles.doingChip, { backgroundColor: `${colors.brand}18` }]}
          onPress={() => void Haptics.selectionAsync()}
        >
          <Text style={{ color: colors.brand, fontWeight: "600", fontSize: 14 }}>
            {doing.length} doing across {doingProjects} project{doingProjects === 1 ? "" : "s"}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              setPullHint(true);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            tintColor={colors.brand}
          />
        }
      >
        {pullHint ? (
          <View style={styles.quickAddRow}>
            <TextInput
              value={quickAdd}
              onChangeText={setQuickAdd}
              placeholder="Add to Inbox…"
              placeholderTextColor={colors.muted}
              style={styles.quickAddInput}
              onSubmitEditing={() => void onQuickAdd()}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => void onQuickAdd()}
              style={[styles.addButton, { backgroundColor: colors.brand }]}
            >
              <Text style={styles.micLabel}>Add</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.hint}>
            Pull down to quick-add · Swipe right to complete · Swipe left for actions · Long-press
            to reorder
          </Text>
        )}

        {tasks.length === 0 ? (
          <Text style={styles.empty}>Inbox zero. Pull down to add a task.</Text>
        ) : (
          <Sortable.Flex
            flexDirection="column"
            gap={8}
            dragActivationDelay={220}
            onDragEnd={onDragEnd}
          >
            {tasks.map((task) => (
              <NowTaskRow
                key={task.id}
                task={task}
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

      <CaptureSheet
        visible={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSend={() => setCaptureOpen(false)}
      />
    </View>
  );
}

function NowTaskRow(props: {
  readonly task: Task;
  readonly onOpen: () => void;
  readonly onComplete: () => void;
  readonly onDelete: () => void;
  readonly onTop: () => void;
  readonly onBottom: () => void;
}) {
  /** Revealed by swiping right — complete. */
  function renderLeftActions() {
    return (
      <View style={styles.actionRow}>
        <Pressable onPress={props.onComplete} style={[styles.actionBtn, { backgroundColor: colors.do }]}>
          <Text style={styles.micLabel}>Done</Text>
        </Pressable>
      </View>
    );
  }

  /** Revealed by swiping left — top / bottom / delete. */
  function renderRightActions() {
    return (
      <View style={styles.actionRow}>
        <Pressable onPress={props.onTop} style={[styles.actionBtn, { backgroundColor: colors.brand }]}>
          <Text style={styles.actionLabel}>Top</Text>
        </Pressable>
        <Pressable
          onPress={props.onBottom}
          style={[styles.actionBtn, { backgroundColor: colors.schedule }]}
        >
          <Text style={styles.actionLabel}>Bottom</Text>
        </Pressable>
        <Pressable
          onPress={props.onDelete}
          style={[styles.actionBtn, { backgroundColor: colors.eliminate }]}
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
        // LEFT means the left-side actions were opened (user swiped right).
        if (direction === SwipeDirection.LEFT) props.onComplete();
      }}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
    >
      <Pressable onPress={props.onOpen} style={styles.taskCard}>
        <View style={styles.taskRow}>
          {props.task.status === "in_progress" ? (
            <View style={[styles.doingBadge, { backgroundColor: colors.brand }]}>
              <Text style={styles.actionLabel}>Doing</Text>
            </View>
          ) : null}
          <Text style={styles.taskTitle}>{props.task.title}</Text>
        </View>
        <Text style={styles.meta}>{props.task.quadrant ?? "Inbox"}</Text>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  micButton: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  micLabel: { color: "#fff", fontWeight: "600", fontSize: 14 },
  doingChip: { marginHorizontal: 16, marginBottom: 8, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  quickAddRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  quickAddInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  addButton: { justifyContent: "center", borderRadius: 16, paddingHorizontal: 12 },
  hint: { marginBottom: 12, fontSize: 12, color: colors.muted },
  empty: { marginTop: 32, textAlign: "center", color: colors.muted },
  actionRow: { flexDirection: "row", alignItems: "stretch" },
  actionBtn: { justifyContent: "center", paddingHorizontal: 12 },
  actionLabel: { color: "#fff", fontWeight: "600", fontSize: 12 },
  taskCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  doingBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  taskTitle: { flex: 1, fontSize: 16, color: colors.ink },
  meta: { marginTop: 4, fontSize: 12, color: colors.muted, textTransform: "capitalize" },
});
