import type { ProjectId, Task } from "@yatma/core";
import { addCalendarDays, localCalendarDate } from "@yatma/core";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { selectProjectTasks } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { DateEditor, IconButton } from "../../ui";

export type ProjectTaskFilter = "all" | "overdue" | "upcoming" | "undated";
const FILTERS = [
  { key: "all", title: "All" },
  { key: "overdue", title: "Overdue" },
  { key: "upcoming", title: "Next 7 days" },
  { key: "undated", title: "No date" },
] as const;

/** Enrich project tasks in priority order without leaving the project to manage dates. */
export function ProjectTaskList(props: {
  readonly projectId: ProjectId;
  readonly initialFilter?: ProjectTaskFilter;
}) {
  const theme = useTheme();
  const store = useAppStore();
  const [filter, setFilter] = useState<ProjectTaskFilter>(props.initialFilter ?? "all");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = selectProjectTasks(store.state.folded, props.projectId);
  const today = localCalendarDate(new Date());
  const filtered = tasks.filter(
    (task) =>
      filter === "all" ||
      (filter === "undated"
        ? task.dueDate === null
        : task.dueDate !== null &&
          (filter === "overdue"
            ? task.dueDate < today
            : task.dueDate >= today && task.dueDate <= addCalendarDays(today, 7))),
  );

  async function addTask() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.createTask({ title: draft.trim(), projectId: props.projectId });
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 12 }}>
        {tasks.length} outstanding. Highest priority first.
      </Text>
      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === item.key }}
            onPress={() => setFilter(item.key)}
            style={[
              styles.filter,
              {
                backgroundColor: filter === item.key ? theme.colors.pineSoft : theme.colors.surface,
              },
            ]}
          >
            <Text
              style={{
                color: filter === item.key ? theme.colors.pine : theme.colors.muted,
                fontSize: 13,
              }}
            >
              {item.title}
            </Text>
          </Pressable>
        ))}
      </View>
      {filtered.length ? (
        filtered.map((task) => <ProjectTask key={task.id} task={task} />)
      ) : (
        <Text style={{ color: theme.colors.muted, fontSize: 15, paddingVertical: 28 }}>
          {filter === "all" ? "No outstanding tasks. Add one below." : "No tasks match this view."}
        </Text>
      )}
      <View style={[styles.add, { borderColor: theme.colors.line }]}>
        <TextInput
          accessibilityLabel="New project task"
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a task to this project…"
          placeholderTextColor={theme.colors.muted}
          maxLength={200}
          onSubmitEditing={() => void addTask()}
          style={{ flex: 1, color: theme.colors.ink, minHeight: 44, fontSize: 15 }}
        />
        <IconButton
          name="add-circle-outline"
          accessibilityLabel="Add project task"
          disabled={busy || !draft.trim()}
          onPress={() => void addTask()}
          color={theme.colors.pine}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function ProjectTask(props: { readonly task: Task }) {
  const theme = useTheme();
  const store = useAppStore();
  const [editingDate, setEditingDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
    <View style={[styles.task, { borderBottomColor: theme.colors.line }]}>
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
        <View style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/task/${task.id}`} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`Open task: ${task.title}`}>
              <Text
                style={{ color: theme.colors.ink, fontSize: 17, fontWeight: "600", lineHeight: 24 }}
              >
                {task.title}
              </Text>
            </Pressable>
          </Link>
          <Text
            style={{
              color: overdue ? theme.colors.danger : theme.colors.muted,
              fontSize: 13,
              marginTop: 3,
            }}
          >
            {task.dueDate ? `${overdue ? "Overdue" : "Due"} ${task.dueDate}` : "No due date"}
            {task.status === "in_progress" ? "  In progress" : ""}
          </Text>
        </View>
        <IconButton
          name="calendar-outline"
          accessibilityLabel={`Manage due date: ${task.title}`}
          color={theme.colors.pine}
          onPress={() => setEditingDate(!editingDate)}
        />
      </View>
      {editingDate ? (
        <View style={{ paddingLeft: 44, paddingBottom: 12 }}>
          <DateEditor
            value={task.dueDate}
            label={`Due date for ${task.title}`}
            onSave={(dueDate) => store.updateTask({ taskId: task.id, dueDate })}
          />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, maxWidth: 760, width: "100%", alignSelf: "center" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  filter: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10 },
  task: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  taskLine: { flexDirection: "row", alignItems: "center", minHeight: 60 },
  check: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  circle: { width: 21, height: 21, borderWidth: 1.5, borderRadius: 11 },
  add: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    marginTop: 24,
    marginBottom: 12,
  },
});
