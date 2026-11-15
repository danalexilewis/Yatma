import {
  localCalendarDate,
  selectTaskCatalog,
  type ProjectId,
  type TaskId,
  type TaskCatalogFilter,
} from "@yatma/core";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";
import { IconButton, Screen, ScreenHeader } from "../../ui";
import { useStackPlayer } from "../player/PlayerProvider";
import { TaskMetadata } from "../task/TaskMetadata";
import { useTaskNavigation } from "../task/useTaskNavigation";
import { TaskToolbar } from "./TaskToolbar";

/** Browse and assign tasks independently of project membership or today's commitments. */
export function TasksScreen(props: {
  readonly projectId?: ProjectId;
  readonly initialDue?: TaskCatalogFilter["due"];
}) {
  const store = useAppStore();
  const player = useStackPlayer();
  const theme = useTheme();
  const navigation = useTaskNavigation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaskCatalogFilter["status"]>("open");
  const [sort, setSort] = useState<TaskCatalogFilter["sort"]>("priority");
  const [scheduled, setScheduled] = useState<NonNullable<TaskCatalogFilter["scheduled"]>>("all");
  const [due, setDue] = useState<TaskCatalogFilter["due"]>(props.initialDue ?? "all");
  const [projectId, setProjectId] = useState<ProjectId | null | undefined>(props.projectId);
  const [selected, setSelected] = useState<TaskId[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [scheduling, setScheduling] = useState<TaskId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folded = store.state.folded;
  const projects = [...folded.projects.values()];
  const tasks = selectTaskCatalog([...folded.tasks.values()], {
    query,
    status,
    sort,
    due,
    scheduled,
    projectId: props.projectId ?? projectId,
    today: localCalendarDate(new Date()),
  });
  const selectedTasks = selected.filter((id) => folded.tasks.has(id));
  const selectedProjects = new Set(selectedTasks.map((id) => folded.tasks.get(id)?.projectId));
  const selectedProject = selectedProjects.size === 1 ? [...selectedProjects][0] : undefined;
  async function assign(next: ProjectId | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.executeLocalCommands(
        selectedTasks.map((taskId) => ({
          type: "task.update" as const,
          input: { taskId, projectId: next },
        })),
      );
      setSelected([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign tasks.");
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await store.createTask({ title: draft.trim(), projectId: props.projectId ?? null });
      setDraft("");
      setCreating(false);
      setQuery("");
      setStatus("open");
      setDue("all");
      setScheduled("all");
      setProjectId(props.projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create task.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleTodaySchedule(taskId: TaskId) {
    if (scheduling) return;
    setScheduling(taskId);
    setError(null);
    try {
      if (folded.tasks.get(taskId)?.scheduledDate === player.date)
        await player.daily.scheduleTask(taskId, null, player.date, player.timezone);
      else await player.daily.scheduleTask(taskId, player.date, player.date, player.timezone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update scheduling.");
    } finally {
      setScheduling(null);
    }
  }
  function toggle(taskId: TaskId) {
    setSelected((ids) =>
      ids.includes(taskId) ? ids.filter((id) => id !== taskId) : [...ids, taskId],
    );
  }
  return (
    <Screen>
      {!props.projectId ? <ScreenHeader title="Tasks" /> : null}
      <TaskToolbar
        query={query}
        onQuery={setQuery}
        status={status}
        onStatus={(value) => {
          setStatus(value);
          setSelected([]);
        }}
        sort={sort}
        onSort={setSort}
        scheduled={scheduled}
        onScheduled={setScheduled}
        due={due}
        onDue={setDue}
        projectId={projectId}
        onProject={setProjectId}
        scoped={!!props.projectId}
        projects={projects}
        count={tasks.length}
        selected={selectedTasks.length}
        allSelected={tasks.length > 0 && tasks.every((task) => selectedTasks.includes(task.id))}
        onSelectAll={() => setSelected(tasks.map((task) => task.id))}
        onClear={() => setSelected([])}
        onAssign={(id) => void assign(id)}
        selectedProject={selectedProject}
        busy={busy}
        onCreate={() => setCreating(true)}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger, padding: 16 }}>
          {error}
        </Text>
      ) : null}
      {creating ? (
        <View style={[styles.row, { marginHorizontal: 16, borderColor: theme.colors.line }]}>
          <TextInput
            autoFocus
            accessibilityLabel="New task title"
            value={draft}
            onChangeText={setDraft}
            placeholder={props.projectId ? "Task name" : "Task name — project optional"}
            placeholderTextColor={theme.colors.muted}
            style={{ flex: 1, minHeight: 44, color: theme.colors.ink }}
            onSubmitEditing={() => void create()}
          />
          <IconButton
            name="checkmark-outline"
            accessibilityLabel="Create task"
            disabled={busy || !draft.trim()}
            onPress={() => void create()}
          />
          <IconButton
            name="close-outline"
            accessibilityLabel="Cancel new task"
            disabled={busy}
            onPress={() => {
              setCreating(false);
              setDraft("");
            }}
          />
        </View>
      ) : null}
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        renderItem={({ item: task }) => (
          <View style={[styles.row, { borderColor: theme.colors.line }]}>
            <Pressable
              disabled={busy}
              accessibilityRole="checkbox"
              accessibilityLabel={`Select ${task.title}`}
              accessibilityState={{ checked: selectedTasks.includes(task.id) }}
              onPress={() => toggle(task.id)}
              style={styles.check}
            >
              <Text style={{ color: theme.colors.pine, fontSize: 22 }}>
                {selectedTasks.includes(task.id) ? "☑" : "☐"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open task: ${task.title}`}
              onPress={() => navigation.openTask(task.id)}
              style={{ flex: 1, paddingVertical: 12 }}
            >
              <Text style={{ color: theme.colors.ink, fontSize: 17, fontWeight: "600" }}>
                {task.title}
              </Text>
              <TaskMetadata task={task} />
              {task.deletedAt ||
              task.status === "done" ||
              task.dueDate ||
              task.scheduledDate ||
              task.priority ? (
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  {[
                    task.deletedAt ? "Deleted" : task.status === "done" ? "Completed" : null,
                    task.priority
                      ? `${task.priority[0]!.toUpperCase()}${task.priority.slice(1)} priority`
                      : null,
                    task.scheduledDate ? `Scheduled ${task.scheduledDate}` : null,
                    task.dueDate ? `Due ${task.dueDate}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              ) : null}
            </Pressable>
            {!task.deletedAt && task.status !== "done" ? (
              <IconButton
                name="today-outline"
                tooltip={
                  task.scheduledDate === player.date
                    ? "Unschedule from Today"
                    : "Schedule for today"
                }
                accessibilityLabel={
                  task.scheduledDate === player.date
                    ? `Unschedule ${task.title} from Today`
                    : `Schedule ${task.title} for today`
                }
                color={task.scheduledDate === player.date ? theme.colors.pine : undefined}
                disabled={scheduling !== null}
                onPress={() => void toggleTodaySchedule(task.id)}
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.muted, paddingVertical: 24 }}>
            No tasks match this view.
          </Text>
        }
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40, width: "100%", alignSelf: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
