import type { ProjectId, Task, TaskId, TaskUpdateInput, ThreadEntry } from "@yatma/core";
import { Ionicons } from "@expo/vector-icons";
import { selectThreadHistory, selectThreadTasks } from "@yatma/core";
import { Link } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FlatList } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import DraggableFlatList, {
  type DragEndParams,
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import { MessageWithRefs } from "./RefUnfurl";
import { PriorityTaskRow } from "./PriorityTaskRow";
import { priorityRows, taskUpdateFromDrop, type PriorityRow } from "./taskReorder";
import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";
import { IconButton } from "../../ui";
import { UndoReasonDialog } from "../../ui/UndoReasonDialog";

const THREAD_CONTENT_PADDING_TOP = 12;

type TaskThreadProps = {
  readonly collapsed: boolean;
  readonly onCollapse: () => void;
  readonly onStickySummaryChange: (visible: boolean) => void;
  readonly returnToPriorityRequest: number;
  readonly onChooseProject: (projectId: ProjectId | null) => void;
  readonly footer?: ReactNode;
};

/** One scroll surface: immutable conversation/completion history, then the live priority list. */
export function TaskThread(props: TaskThreadProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const store = useAppStore();
  const folded = store.state.folded;
  const history = selectThreadHistory(folded);
  const tasks = selectThreadTasks(folded);
  const [grouped, setGrouped] = useState(false);
  const rows = props.collapsed ? [] : priorityRows(tasks, folded.projects, grouped);
  const [error, setError] = useState<string | null>(null);
  const [completionToUndo, setCompletionToUndo] = useState<TaskId | null>(null);
  const stickySummaryVisible = useRef(false);
  const [savingIds, setSavingIds] = useState<ReadonlySet<TaskId>>(new Set());
  const [spacerHeight, setSpacerHeight] = useState(0);
  const contentHeight = useRef(0);
  const savingRef = useRef(new Set<TaskId>());
  const followConversation = useRef(true);
  const scrollRef = useRef<FlatList<PriorityRow>>(null);
  const columnRef = useRef<ComponentRef<typeof View>>(null);
  const priorityRef = useRef<ComponentRef<typeof View>>(null);
  const latestCompletionRef = useRef<ComponentRef<typeof View>>(null);
  const observedCompletion = useRef<string | null | undefined>(undefined);
  const completionToReveal = useRef<string | null>(null);
  const positioned = useRef(false);
  const priorityY = useRef<number | null>(null);
  const viewportHeight = useRef(0);
  const latestCompletion = history.findLast((entry) => entry.kind === "completed");

  function positionThread() {
    if (
      positioned.current ||
      props.collapsed ||
      completionToReveal.current !== null ||
      !store.state.ready ||
      priorityY.current === null ||
      viewportHeight.current === 0
    )
      return;
    const headerTop = 12;
    const targetY = Math.max(0, priorityY.current - headerTop);
    if (contentHeight.current < targetY + viewportHeight.current - 1) return;
    positioned.current = true;
    scrollRef.current?.scrollToOffset({ offset: targetY, animated: false });
  }

  function measurePriority() {
    const column = columnRef.current;
    if (!column) return;
    priorityRef.current?.measureLayout(column, (_x, y) => {
      priorityY.current = y;
      updateSpacer();
      positionThread();
    });
  }

  function updateSpacer() {
    if (props.collapsed || priorityY.current === null) return;
    // Let a short task list fill the viewport, so initial positioning can hide history.
    const priorityHeight = contentHeight.current - spacerHeight - priorityY.current;
    setSpacerHeight(Math.max(0, viewportHeight.current - priorityHeight));
  }

  function revealCompletion() {
    const column = columnRef.current;
    const completionId = completionToReveal.current;
    if (!column || !completionId) return;
    latestCompletionRef.current?.measureLayout(column, (_x, y) => {
      if (completionToReveal.current !== completionId) return;
      // Completion is a reading position too; do not immediately re-anchor to tasks.
      positioned.current = true;
      completionToReveal.current = null;
      scrollRef.current?.scrollToOffset({ offset: Math.max(0, y - 12), animated: !reducedMotion });
    });
  }

  function returnToPriority() {
    const y = priorityY.current;
    if (y === null) return;
    scrollRef.current?.scrollToOffset({ offset: Math.max(0, y - 12), animated: !reducedMotion });
  }

  useEffect(() => {
    if (!store.state.ready) return;
    const previous = observedCompletion.current;
    observedCompletion.current = latestCompletion?.id ?? null;
    if (previous !== undefined && latestCompletion && previous !== latestCompletion.id) {
      completionToReveal.current = latestCompletion.id;
      revealCompletion();
    }
  }, [latestCompletion?.id, store.state.ready]);

  useEffect(() => {
    if (store.state.ready) measurePriority();
  }, [store.state.ready, tasks.length, history.length, grouped]);

  useEffect(() => {
    if (props.collapsed) {
      if (stickySummaryVisible.current) {
        stickySummaryVisible.current = false;
        props.onStickySummaryChange(false);
      }
      followConversation.current = true;
      const frame = requestAnimationFrame(() =>
        scrollRef.current?.scrollToEnd({ animated: !reducedMotion }),
      );
      return () => cancelAnimationFrame(frame);
    }
    positioned.current = false;
    measurePriority();
  }, [props.collapsed]);

  useEffect(() => {
    if (props.returnToPriorityRequest > 0) returnToPriority();
  }, [props.returnToPriorityRequest]);

  async function changeTask(input: TaskUpdateInput) {
    if (savingRef.current.has(input.taskId)) return;
    savingRef.current.add(input.taskId);
    setSavingIds(new Set(savingRef.current));
    setError(null);
    try {
      await store.updateTask(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the task. Try again.");
    } finally {
      savingRef.current.delete(input.taskId);
      setSavingIds(new Set(savingRef.current));
    }
  }

  async function undoCompletion(reason: string) {
    if (!completionToUndo) return;
    try {
      await store.updateTask({ taskId: completionToUndo, status: "todo", reason });
      setCompletionToUndo(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reopen the task.");
      throw cause;
    }
  }

  function moveTask(task: Task, members: readonly Task[], direction: "up" | "down") {
    const index = members.findIndex((item) => item.id === task.id);
    const neighbor = members[index + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    void changeTask({
      taskId: task.id,
      placement: { kind: direction === "up" ? "before" : "after", taskId: neighbor.id },
    });
  }

  function reorder({ data, from, to }: DragEndParams<PriorityRow>) {
    const input = taskUpdateFromDrop(data, from, to);
    if (input) void changeTask(input);
  }

  function renderPriorityRow({ item, drag, isActive }: RenderItemParams<PriorityRow>) {
    return (
      <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
        {item.kind === "project" ? (
          <View style={styles.groupHeader}>
            {item.projectId ? (
              <Link href={`/project/${item.projectId}/overview`} asChild>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open project: ${item.title}`}
                  style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                >
                  <Text
                    accessibilityRole="header"
                    style={[styles.groupTitle, { color: theme.colors.ink }]}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              </Link>
            ) : (
              <Text
                accessibilityRole="header"
                style={[styles.groupTitle, { color: theme.colors.ink }]}
              >
                {item.title}
              </Text>
            )}
            <IconButton
              name="add-outline"
              accessibilityLabel={`Add task to ${item.title}`}
              color={theme.colors.pine}
              onPress={() => props.onChooseProject(item.projectId)}
            />
          </View>
        ) : (
          <PriorityTaskRow
            task={item.task}
            projectTitle={
              item.task.projectId ? folded.projects.get(item.task.projectId)?.title : undefined
            }
            saving={savingIds.has(item.task.id)}
            dragging={isActive}
            onDrag={drag}
            canMoveUp={tasks.findIndex((task) => task.id === item.task.id) > 0}
            canMoveDown={tasks.findIndex((task) => task.id === item.task.id) < tasks.length - 1}
            onChange={changeTask}
            onUp={() => moveTask(item.task, tasks, "up")}
            onDown={() => moveTask(item.task, tasks, "down")}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.threadContainer}>
      <DraggableFlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderPriorityRow}
        onDragEnd={reorder}
        activationDistance={8}
        containerStyle={styles.scroll}
        ref={scrollRef}
        accessibilityLabel="Task thread"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          measurePriority();
        }}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          if (completionToReveal.current) revealCompletion();
          else if (props.collapsed && followConversation.current)
            scrollRef.current?.scrollToEnd({ animated: !reducedMotion });
          else measurePriority();
        }}
        scrollEventThrottle={16}
        onScrollOffsetChange={(offset) => {
          if (props.collapsed) {
            followConversation.current =
              contentHeight.current - viewportHeight.current - offset < 80;
            return;
          }
          // Measurements are relative to the column, below the scroll content's
          // top padding. Show the dock only once the whole task section is below view.
          const tasksOutsideViewport =
            priorityY.current !== null &&
            priorityY.current + THREAD_CONTENT_PADDING_TOP >= offset + viewportHeight.current;
          if (stickySummaryVisible.current !== tasksOutsideViewport) {
            stickySummaryVisible.current = tasksOutsideViewport;
            props.onStickySummaryChange(tasksOutsideViewport);
          }
        }}
        ListHeaderComponent={
          <View ref={columnRef} style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
            {history.map((entry, index) => {
              const showDay = index === 0 || dayKey(history[index - 1]!.at) !== dayKey(entry.at);
              return (
                <View
                  key={entry.id}
                  ref={entry.id === latestCompletion?.id ? latestCompletionRef : undefined}
                  onLayout={entry.id === latestCompletion?.id ? revealCompletion : undefined}
                >
                  {showDay ? (
                    <Text style={[styles.day, { color: theme.colors.muted }]}>
                      {dayLabel(entry.at)}
                    </Text>
                  ) : null}
                  <HistoryEntry
                    entry={entry}
                    saving={entry.kind === "completed" && savingIds.has(entry.taskId)}
                    onChange={changeTask}
                    onReopen={(taskId) => setCompletionToUndo(taskId)}
                  />
                </View>
              );
            })}

            {props.footer}

            {!props.collapsed ? (
              <View
                ref={priorityRef}
                onLayout={measurePriority}
                style={[styles.priorities, { borderTopColor: theme.colors.line }]}
              >
                <View style={styles.priorityHeader}>
                  <View style={styles.priorityTitle}>
                    <Text
                      accessibilityRole="header"
                      style={[styles.heading, { color: theme.colors.ink }]}
                    >
                      Up next
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
                      {tasks.length}
                    </Text>
                  </View>
                  <View style={styles.headerActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Group tasks by projects"
                      accessibilityState={{ selected: grouped }}
                      onPress={() => setGrouped(!grouped)}
                      style={[
                        styles.groupToggle,
                        { backgroundColor: grouped ? theme.colors.pineSoft : "transparent" },
                      ]}
                    >
                      <Text
                        style={{
                          color: grouped ? theme.colors.pine : theme.colors.muted,
                          fontSize: theme.type.meta,
                          fontWeight: "600",
                        }}
                      >
                        {grouped ? "Grouped" : "Group by project"}
                      </Text>
                    </Pressable>
                    <IconButton
                      name="chevron-down-outline"
                      accessibilityLabel="Collapse current tasks"
                      color={theme.colors.muted}
                      onPress={props.onCollapse}
                    />
                  </View>
                </View>
                <Text style={[styles.hint, { color: theme.colors.muted }]}>
                  Highest priority first. Drag the handle or hold a task to reorder. Drag between
                  projects to move a task.
                </Text>

                {tasks.length === 0 ? (
                  <Text style={[styles.empty, { color: theme.colors.muted }]}>
                    {history.length
                      ? "You're all caught up. Your history stays above."
                      : "Add your first task, a project, or a message below."}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View
            style={[
              styles.column,
              {
                paddingHorizontal: theme.space.screenX,
                minHeight: props.collapsed ? 0 : spacerHeight,
              },
            ]}
          >
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.colors.danger }]}
              >
                {error}
              </Text>
            ) : null}
          </View>
        }
      />
      <UndoReasonDialog
        visible={completionToUndo !== null}
        onCancel={() => setCompletionToUndo(null)}
        onSubmit={undoCompletion}
      />
    </View>
  );
}

/** A compact task rail above the prompt keeps priority within reach during conversation. */
export function TaskThreadSummary(props: { readonly onExpand: () => void }) {
  const theme = useTheme();
  const store = useAppStore();
  const tasks = selectThreadTasks(store.state.folded);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show current tasks (${tasks.length})`}
      accessibilityState={{ expanded: false }}
      onPress={props.onExpand}
      style={styles.summary}
    >
      <Ionicons name="list-outline" size={17} color={theme.colors.pine} />
      <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta, fontWeight: "600" }}>
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
      </Text>
      <Text
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, color: theme.colors.muted, fontSize: theme.type.meta }}
      >
        {tasks[0]?.title ?? "All caught up"}
      </Text>
      <Ionicons name="chevron-up" size={15} color={theme.colors.muted} />
    </Pressable>
  );
}

function HistoryEntry(props: {
  readonly entry: ThreadEntry;
  readonly saving: boolean;
  readonly onChange: (input: TaskUpdateInput) => Promise<void>;
  readonly onReopen: (taskId: TaskId) => void;
}) {
  const theme = useTheme();
  const store = useAppStore();
  const entry = props.entry;
  const time = new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (entry.kind === "message") {
    const user = entry.message.role === "user";
    return (
      <View
        style={[
          styles.message,
          user
            ? { alignSelf: "flex-end", backgroundColor: theme.colors.surface }
            : { alignSelf: "stretch" },
        ]}
      >
        <Text style={[styles.messageMeta, { color: theme.colors.muted }]}>
          {user ? "You" : entry.message.role === "assistant" ? "Yatma" : "Note"} {time}
        </Text>
        {user ? (
          <Text style={{ color: theme.colors.ink, fontSize: theme.type.row, lineHeight: 25 }}>
            {entry.message.text}
          </Text>
        ) : (
          <MessageWithRefs text={entry.message.text} taskLinksOnly />
        )}
      </View>
    );
  }
  const current = store.state.folded.tasks.get(entry.taskId);
  const canReopen =
    current?.status === "done" && current.deletedAt === null && current.completedAt === entry.at;
  return (
    <View style={styles.completion} accessibilityLabel={`Completed ${entry.title} at ${time}`}>
      <View style={[styles.doneCircle, { backgroundColor: theme.colors.pine }]}>
        <Text style={{ color: theme.colors.onPine, fontSize: 13, fontWeight: "700" }}>✓</Text>
      </View>
      <View style={styles.completionCopy}>
        <TaskLink taskId={entry.taskId} title={entry.title} />
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 3 }}>
          Completed at {time}
        </Text>
      </View>
      {canReopen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reopen ${entry.title}`}
          disabled={props.saving}
          onPress={() => props.onReopen(entry.taskId)}
          style={styles.undo}
        >
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta, fontWeight: "600" }}>
            Undo
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Local day boundaries keep late-night completions beside the correct conversation.
function dayKey(at: string) {
  return new Date(at).toDateString();
}
function dayLabel(at: string) {
  const date = new Date(at);
  if (dayKey(at) === new Date().toDateString()) return "Today";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function TaskLink(props: { readonly taskId: TaskId; readonly title: string }) {
  const theme = useTheme();
  return (
    <Link href={`/task/${props.taskId}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open task: ${props.title}`}
        style={styles.taskLink}
      >
        <Text
          style={{
            color: theme.colors.ink,
            fontSize: theme.type.row,
            fontWeight: "600",
            lineHeight: 24,
          }}
        >
          {props.title}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  threadContainer: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: THREAD_CONTENT_PADDING_TOP, paddingBottom: 28 },
  column: { width: "100%", maxWidth: 760, alignSelf: "center" },
  day: { textAlign: "center", fontSize: 12, fontWeight: "500", paddingTop: 16, paddingBottom: 20 },
  message: {
    maxWidth: "92%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  messageMeta: { fontSize: 12, marginBottom: 5 },
  completion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 10,
    marginBottom: 8,
  },
  doneCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  completionCopy: { flex: 1, minWidth: 0 },
  undo: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  priorities: { marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  priorityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  summary: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 20,
    gap: 10,
  },
  priorityTitle: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  heading: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  groupToggle: { minHeight: 44, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center" },
  groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitle: { fontSize: 17, fontWeight: "700" },
  taskLink: { minHeight: 28, justifyContent: "center" },
  empty: { fontSize: 15, lineHeight: 23, paddingVertical: 20, paddingHorizontal: 6 },
  error: { fontSize: 13, marginTop: 12 },
});
