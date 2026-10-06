import type { Task, TaskId } from "@yatma/core";
import { TaskId as TaskIdSchema } from "@yatma/core";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
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
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-50">Now</Text>
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => setCaptureOpen(true)}
            className="rounded-full px-3 py-1.5"
            style={{ backgroundColor: colors.brand }}
          >
            <Text className="text-sm font-medium text-white">Mic</Text>
          </Pressable>
          <Link href="/settings" asChild>
            <Pressable>
              <Text style={{ color: colors.brand }}>Settings</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {doing.length > 0 ? (
        <Pressable
          className="mx-4 mb-2 rounded-full px-3 py-2"
          style={{ backgroundColor: `${colors.brand}18` }}
          onPress={() => void Haptics.selectionAsync()}
        >
          <Text className="text-sm font-medium" style={{ color: colors.brand }}>
            {doing.length} doing across {doingProjects} project{doingProjects === 1 ? "" : "s"}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView
        className="flex-1 px-4"
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
          <View className="mb-3 flex-row gap-2">
            <TextInput
              value={quickAdd}
              onChangeText={setQuickAdd}
              placeholder="Add to Inbox…"
              placeholderTextColor={colors.muted}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              onSubmitEditing={() => void onQuickAdd()}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => void onQuickAdd()}
              className="justify-center rounded-2xl px-3"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="font-medium text-white">Add</Text>
            </Pressable>
          </View>
        ) : (
          <Text className="mb-3 text-xs text-slate-500">
            Pull down to quick-add · Swipe right to complete · Swipe left for actions · Long-press
            to reorder
          </Text>
        )}

        {tasks.length === 0 ? (
          <Text className="mt-8 text-center text-slate-500">
            Inbox zero. Pull down to add a task.
          </Text>
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
      <View className="mb-0 flex-row items-stretch pr-2">
        <Pressable
          onPress={props.onComplete}
          className="justify-center px-4"
          style={{ backgroundColor: colors.do }}
        >
          <Text className="font-medium text-white">Done</Text>
        </Pressable>
      </View>
    );
  }

  /** Revealed by swiping left — top / bottom / delete. */
  function renderRightActions() {
    return (
      <View className="mb-0 flex-row items-stretch pl-2">
        <Pressable
          onPress={props.onTop}
          className="justify-center px-3"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-xs font-medium text-white">Top</Text>
        </Pressable>
        <Pressable
          onPress={props.onBottom}
          className="justify-center px-3"
          style={{ backgroundColor: colors.schedule }}
        >
          <Text className="text-xs font-medium text-white">Bottom</Text>
        </Pressable>
        <Pressable
          onPress={props.onDelete}
          className="justify-center px-3"
          style={{ backgroundColor: colors.eliminate }}
        >
          <Text className="text-xs font-medium text-white">Delete</Text>
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
      <Pressable
        onPress={props.onOpen}
        className="rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
      >
        <View className="flex-row items-center gap-2">
          {props.task.status === "in_progress" ? (
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.brand }}>
              <Text className="text-3xs text-white">Doing</Text>
            </View>
          ) : null}
          <Text className="flex-1 text-base text-slate-900 dark:text-slate-50">
            {props.task.title}
          </Text>
        </View>
        {props.task.quadrant ? (
          <Text className="mt-1 text-xs capitalize text-slate-500">{props.task.quadrant}</Text>
        ) : (
          <Text className="mt-1 text-xs text-slate-500">Inbox</Text>
        )}
      </Pressable>
    </Swipeable>
  );
}
