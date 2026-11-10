import type { ProjectId, Quadrant, Task } from "@yatma/core";
import { localCalendarDate, MATRIX_QUADRANTS, quadrantLabel, selectThreadTasks } from "@yatma/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { selectActiveProjects } from "../../state/selectors";
import { quadrantColor, useTheme } from "../../theme/theme";
import { IconButton, Screen, ScreenHeader } from "../../ui";
import { DEFAULT_TRIAGE_CAPACITY, getTriageCapacity } from "./triagePreferences";

/** Personal Eisenhower matrix; quadrant placement is independent of global task priority. */
export function TriageScreen() {
  const theme = useTheme();
  const store = useAppStore();
  const [projectId, setProjectId] = useState<ProjectId | null | undefined>(undefined);
  const [movingId, setMovingId] = useState<Task["id"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(DEFAULT_TRIAGE_CAPACITY);
  const [selectedBucket, setSelectedBucket] = useState<Quadrant | null>(null);
  const [swipeMode, setSwipeMode] = useState(false);
  useEffect(() => {
    let active = true;
    void getTriageCapacity().then((value) => { if (active) setCapacity(value); });
    return () => { active = false; };
  }, []);
  const tasks = selectThreadTasks(store.state.folded).filter(
    (task) => projectId === undefined || task.projectId === projectId,
  );
  const unsorted = tasks.filter((task) => task.quadrant === null || task.quadrant === "eliminate");
  const moving = movingId ? store.state.folded.tasks.get(movingId) : undefined;
  const projects = selectActiveProjects(store.state.folded);
  const filters = [
    { id: undefined, title: "All projects" },
    { id: null, title: "Unassigned" },
    ...projects,
  ];

  async function move(quadrant: Quadrant | null) {
    if (!moving || saving) return;
    const bucketCount = tasks.filter((task) => task.quadrant === quadrant).length;
    if (quadrant && quadrant !== moving.quadrant && quadrant !== "eliminate" && bucketCount >= capacity) {
      setError(`This bucket is full. Increase its limit in Settings.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await store.updateTask({ taskId: moving.id, quadrant });
      setMovingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move the task. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function choose(task: Task) {
    setError(null);
    setMovingId(task.id);
  }

  return (
    <Screen>
      <View style={styles.topHeader}>
        <View style={{ flex: 1 }}>
          <ScreenHeader title={selectedBucket ? quadrantLabel(selectedBucket) : "Task triage"} subtitle={selectedBucket ? "Tasks in this bucket" : "Sort your tasks into three buckets."} />
        </View>
        {selectedBucket ? <IconButton name="arrow-back-outline" accessibilityLabel="Back to task triage" onPress={() => setSelectedBucket(null)} /> : <IconButton name={swipeMode ? "list-outline" : "albums-outline"} accessibilityLabel={swipeMode ? "Switch to bucket list" : "Switch to swipe mode"} onPress={() => setSwipeMode(!swipeMode)} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((project) => (
            <Pressable
              key={project.id === undefined ? "all" : (project.id ?? "unassigned")}
              accessibilityRole="button"
              accessibilityState={{ selected: projectId === project.id }}
              onPress={() => setProjectId(project.id)}
              style={[
                styles.filter,
                {
                  backgroundColor:
                    projectId === project.id ? theme.colors.pineSoft : theme.colors.surface,
                },
              ]}
            >
              <Text
                style={{
                  color: projectId === project.id ? theme.colors.pine : theme.colors.muted,
                  fontSize: 13,
                }}
              >
                {project.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {selectedBucket === null && !swipeMode ? <>
        <View style={styles.bucketRow}>
          {MATRIX_QUADRANTS.filter((quadrant) => quadrant.key !== "eliminate").map((quadrant) => {
            const count = tasks.filter((task) => task.quadrant === quadrant.key).length;
            const color = quadrantColor(theme, quadrant.key);
            return <Pressable key={quadrant.key} accessibilityRole="button" onPress={() => setSelectedBucket(quadrant.key)} style={[styles.bucketCard, { borderColor: theme.colors.line, backgroundColor: theme.colors.surface }]}>
              <View style={[styles.bucketDot, { backgroundColor: color }]} />
              <Text numberOfLines={2} style={{ color: theme.colors.ink, fontSize: 13, fontWeight: "700", flex: 1 }}>{quadrant.label}</Text>
              <Text style={{ color: count >= capacity ? theme.colors.danger : theme.colors.muted, fontSize: 12 }}>{count}/{capacity}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={[styles.hint, { color: theme.colors.muted }]}>Choose a task to place it in a bucket, or open a bucket to review its tasks.</Text>
        </> : null}
        {selectedBucket ? (
          tasks.filter((task) => task.quadrant === selectedBucket).length ? tasks.filter((task) => task.quadrant === selectedBucket).map((task) => <MatrixTask key={task.id} task={task} projectTitle={task.projectId ? store.state.folded.projects.get(task.projectId)?.title : undefined} onMove={() => choose(task)} />) : <Text style={{ color: theme.colors.muted, paddingVertical: 16 }}>No tasks in this bucket yet.</Text>
        ) : <>
        <View style={styles.unsortedHeader}>
          <Text
            accessibilityRole="header"
            style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "700" }}
          >
            Not important · Not priority
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{unsorted.length}</Text>
        </View>
        <Text style={[styles.hint, { color: theme.colors.muted }]}>{swipeMode ? "Swipe left, right, or up to classify each task." : "Unclassified tasks stay here until you place them."}</Text>
        {unsorted.length ? (
          unsorted.map((task) => (
            <MatrixTask
              key={task.id}
              task={task}
              projectTitle={
                task.projectId ? store.state.folded.projects.get(task.projectId)?.title : undefined
              }
              onMove={() => choose(task)}
            />
          ))
        ) : (
          <Text style={{ color: theme.colors.muted, fontSize: 14, paddingVertical: 16 }}>
            All outstanding tasks have a place.
          </Text>
        )}
        </>}
      </ScrollView>
      <Modal
        visible={!!moving}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setMovingId(null);
        }}
      >
        <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
          <Pressable
            accessibilityLabel="Cancel moving task"
            onPress={() => {
              if (!saving) setMovingId(null);
            }}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[styles.moveSheet, { backgroundColor: theme.colors.surface }]}
          >
            <View style={styles.sheetHeader}>
              <Text
                accessibilityRole="header"
                style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "700", flex: 1 }}
              >
                Choose a quadrant
              </Text>
              <IconButton
                name="close-outline"
                accessibilityLabel="Close quadrant picker"
                disabled={saving}
                onPress={() => setMovingId(null)}
              />
            </View>
            <Text
              style={{ color: theme.colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 12 }}
            >
              {moving?.title}
            </Text>
            {[...MATRIX_QUADRANTS, { key: null, label: "Unsorted" }].map((quadrant) => (
              <Pressable
                key={quadrant.key ?? "unsorted"}
                accessibilityRole="radio"
                accessibilityLabel={`Move to ${quadrant.label}`}
                accessibilityState={{
                  selected: moving?.quadrant === quadrant.key,
                  disabled: saving,
                }}
                disabled={saving}
                onPress={() => void move(quadrant.key)}
                style={[
                  styles.moveChoice,
                  {
                    borderColor: theme.colors.line,
                    backgroundColor:
                      moving?.quadrant === quadrant.key ? theme.colors.pineSoft : "transparent",
                  },
                ]}
              >
                <View
                  style={[styles.dot, { backgroundColor: quadrantColor(theme, quadrant.key) }]}
                />
                <Text style={{ color: theme.colors.ink, fontSize: 15, flex: 1 }}>
                  {quadrant.label}
                </Text>
                <Text style={{ color: theme.colors.pine }}>
                  {moving?.quadrant === quadrant.key ? "✓" : ""}
                </Text>
              </Pressable>
            ))}
            {error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 12 }}>
                {error}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function MatrixTask(props: {
  readonly task: Task;
  readonly projectTitle?: string;
  readonly onMove: () => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const store = useAppStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = props.task;
  const overdue = task.dueDate !== null && task.dueDate < localCalendarDate(new Date());

  async function complete() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await store.updateTask({ taskId: task.id, status: "done" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.task, { borderTopColor: theme.colors.line }]}>
      <View style={styles.taskLine}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Complete ${task.title}`}
          accessibilityState={{ checked: false, disabled: saving }}
          disabled={saving}
          onPress={() => void complete()}
          style={styles.check}
        >
          <View style={[styles.circle, { borderColor: theme.colors.muted }]} />
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open task: ${task.title}`}
          onPress={() => router.push(`/task/${task.id}`)}
          style={styles.taskTitle}
        >
          <Text style={{ color: theme.colors.ink, fontSize: 15, lineHeight: 21 }}>
            {task.title}
          </Text>
        </Pressable>
      </View>
      <View style={styles.taskFooter}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {props.projectTitle ? (
            <Text numberOfLines={1} style={{ color: theme.colors.muted, fontSize: 11 }}>
              {props.projectTitle}
            </Text>
          ) : null}
          {task.dueDate ? (
            <Text
              style={{
                color: overdue ? theme.colors.danger : theme.colors.muted,
                fontSize: 11,
                marginTop: 2,
              }}
            >
              {overdue ? "Overdue" : "Due"} {task.dueDate}
            </Text>
          ) : null}
          {task.status === "in_progress" ? (
            <Text style={{ color: theme.colors.pine, fontSize: 11, marginTop: 2 }}>
              In progress
            </Text>
          ) : null}
        </View>
        <IconButton
          name="move-outline"
          size={18}
          accessibilityLabel={`Move ${task.title}, ${quadrantLabel(task.quadrant)}`}
          color={theme.colors.muted}
          onPress={props.onMove}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topHeader: { flexDirection: "row", alignItems: "center", paddingRight: 12 },
  bucketRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  bucketCard: { flex: 1, minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 9, gap: 6 },
  bucketDot: { width: 8, height: 8, borderRadius: 4 },
  content: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  filters: { gap: 6, paddingBottom: 14 },
  filter: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10 },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: 14 },
  axis: { flexDirection: "row", marginBottom: 8, gap: 10 },
  axisLabel: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: "600" },
  matrix: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: {
    width: "48%",
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 3,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 4,
    minHeight: 170,
  },
  cellHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 4,
  },
  importance: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  empty: { fontSize: 13, lineHeight: 20, paddingTop: 12, paddingBottom: 24 },
  unsortedHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginTop: 28,
    marginBottom: 6,
  },
  task: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  taskLine: { flexDirection: "row", alignItems: "flex-start" },
  check: {
    width: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-start",
    marginLeft: -4,
  },
  circle: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5 },
  taskTitle: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center", paddingVertical: 7 },
  taskFooter: { flexDirection: "row", alignItems: "center", paddingLeft: 40, marginTop: -4 },
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  moveSheet: {
    width: "100%",
    maxWidth: 520,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  moveChoice: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
