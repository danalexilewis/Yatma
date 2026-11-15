import type { ProjectId, TaskStatus, TaskPriority } from "@yatma/core";
import { ProjectId as ProjectIdSchema, TaskId as TaskIdSchema } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";

import {
  addCalendarDays,
  localCalendarDate,
  scheduledDateForPreset,
  type SchedulePreset,
} from "@yatma/core";
import { ChoiceMenu } from "../../ui/ChoiceMenu";
import { TaskTodosEditor } from "./TaskTodosEditor";
import { TaskMetadata } from "./TaskMetadata";
import { MinutesField } from "../today/TodayControls";
import { useTaskInteraction } from "./useTaskInteraction";
import { useTaskNavigation } from "./useTaskNavigation";
import { useStackPlayer } from "../player/PlayerProvider";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import {
  selectActiveProjects,
  selectProject,
  selectTask,
  selectTaskHistory,
} from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { DateEditor, IconButton, Row, Screen } from "../../ui";

const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** Task detail: editable fields, project, history, Discuss → chat. */
export function TaskSheet(props: { readonly closeButton?: ReactNode }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const store = useAppStore();
  const interaction = useTaskInteraction(id ?? "t_00000000");
  const navigation = useTaskNavigation();
  const player = useStackPlayer();
  const { updateTask } = store;
  const task = id ? selectTask(folded, id) : undefined;
  const project = task?.projectId ? selectProject(folded, task.projectId) : undefined;
  const projects = selectActiveProjects(folded);
  const history = id ? selectTaskHistory(folded, id) : [];

  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [estimate, setEstimate] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (task && draftKey !== task.id) {
    setDraftKey(task.id);
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setEstimate(task.estimateMinutes == null ? "" : String(task.estimateMinutes));
    setFieldError(null);
  }

  if (!task) {
    return (
      <Screen edges={["bottom"]}>
        <View style={{ alignItems: "flex-end", paddingHorizontal: 16 }}>{props.closeButton}</View>
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.muted }}>Task not found</Text>
        </View>
      </Screen>
    );
  }

  const inputStyle = {
    color: theme.colors.ink,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 16,
  };
  const currentTask = task;
  const todayEntry = player.entries.find((entry) => entry.taskId === task.id);
  const taskId = TaskIdSchema.make(currentTask.id);
  const today = localCalendarDate(new Date());
  const sunday = scheduledDateForPreset(today, "this_week")!;
  const scheduleGroup = !currentTask.scheduledDate
    ? "later"
    : currentTask.scheduledDate === today
      ? "today"
      : currentTask.scheduledDate > today && currentTask.scheduledDate <= sunday
        ? "this_week"
        : currentTask.scheduledDate > sunday &&
            currentTask.scheduledDate <= addCalendarDays(sunday, 7)
          ? "next_week"
          : null;

  async function saveScheduling(fields: {
    priority?: TaskPriority | null;
    scheduledDate?: string | null;
  }) {
    setFieldError(null);
    try {
      if (fields.scheduledDate !== undefined)
        await player.daily.scheduleTask(taskId, fields.scheduledDate, player.date, player.timezone);
      else await updateTask({ taskId, ...fields });
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : "Could not save scheduling.");
    }
  }
  async function schedule(preset: SchedulePreset) {
    await saveScheduling({
      scheduledDate: scheduledDateForPreset(localCalendarDate(new Date()), preset),
    });
  }

  async function savePlanningFields() {
    const minutes = estimate.trim() ? Number(estimate) : null;
    if (minutes !== null && !(minutes > 0 && minutes <= 1440)) {
      setFieldError("Use an estimate between 1 and 1440 minutes, or leave it blank.");
      return;
    }
    setFieldError(null);
    try {
      await updateTask({
        taskId,
        estimateMinutes: minutes,
      });
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : "Could not save task details.");
    }
  }

  async function toggleTodaySchedule() {
    if (adding) return;
    setAdding(true);
    setFieldError(null);
    try {
      if (currentTask.scheduledDate === player.date)
        await player.daily.scheduleTask(taskId, null, player.date, player.timezone);
      else await player.daily.scheduleTask(taskId, player.date, player.date, player.timezone);
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : "Could not update task scheduling.");
    } finally {
      setAdding(false);
    }
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === currentTask.title) {
      setTitle(currentTask.title);
      return;
    }
    await updateTask({ taskId, title: next });
  }

  async function saveNotes() {
    if (notes === currentTask.notes) return;
    await updateTask({ taskId, notes });
  }

  async function setStatus(status: TaskStatus) {
    if (status === currentTask.status) return;
    try {
      await interaction.setStatus(status);
    } catch {
      /* Shared error is rendered below. */
    }
  }

  async function setProject(projectId: ProjectId | null) {
    if (projectId === currentTask.projectId) return;
    await updateTask({ taskId, projectId });
  }

  async function deleteTask() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await updateTask({ taskId, deleted: true });
      navigation.closeTask();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete the task.");
    } finally {
      setDeleting(false);
    }
  }

  async function recoverTask() {
    try {
      if (!currentTask.deletedAt) {
        await interaction.setStatus("todo");
        return;
      }
      await store.executeLocalCommands([
        {
          type: "task.update",
          input: {
            taskId,
            ...(currentTask.deletedAt ? { deleted: false } : {}),
            ...(currentTask.status === "done" ? { status: "todo" as const } : {}),
            reason: currentTask.deletedAt ? "Restored task" : "Reopened task",
          },
        },
      ]);
    } catch (error) {
      Alert.alert("Could not recover task", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Screen edges={["bottom"]}>
      <View style={[styles.header, { borderColor: theme.colors.line }]}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: theme.colors.ink, fontSize: 18, fontWeight: "600" }}
        >
          Task
        </Text>
        <IconButton
          name="chatbubble-outline"
          accessibilityLabel="Discuss task"
          tooltip="Discuss"
          onPress={() => router.dismissTo({ pathname: "/", params: { taskId: currentTask.id } })}
        />
        {!currentTask.deletedAt && currentTask.status !== "done" ? (
          <IconButton
            name="today-outline"
            accessibilityLabel={
              currentTask.scheduledDate === player.date
                ? "Unschedule from Today"
                : "Schedule for today"
            }
            color={currentTask.scheduledDate === player.date ? theme.colors.pine : undefined}
            disabled={adding}
            onPress={() => void toggleTodaySchedule()}
          />
        ) : null}
        {!currentTask.deletedAt ? (
          <IconButton
            name="trash-outline"
            accessibilityLabel="Delete task"
            disabled={deleting}
            onPress={() => void deleteTask()}
          />
        ) : null}
        {props.closeButton}
      </View>
      {deleteError ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.danger, paddingHorizontal: 20 }}
        >
          {deleteError}
        </Text>
      ) : null}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space.screenX,
          paddingBottom: 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: theme.colors.ink }]}>Task name</Text>
        <TextInput
          accessibilityLabel="Task name"
          value={title}
          onChangeText={setTitle}
          onBlur={() => void saveTitle()}
          onSubmitEditing={() => void saveTitle()}
          style={[inputStyle, { fontSize: 22, fontWeight: "600" }]}
          placeholder="Title"
          placeholderTextColor={theme.colors.muted}
        />

        <View style={{ marginTop: 8 }}>
          <TaskMetadata task={currentTask} />
        </View>
        {todayEntry ? (
          <MinutesField
            label="Today's allocation (minutes)"
            value={todayEntry.allocationMinutes}
            disabled={player.runtimeState.pending}
            onSave={(allocationMinutes) =>
              player.runtime.execute([
                { type: "day.update", entryId: todayEntry.id, set: { allocationMinutes } },
              ])
            }
          />
        ) : null}
        {player.runtimeState.error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {player.runtimeState.error}
          </Text>
        ) : null}
        {currentTask.deletedAt || currentTask.status === "done" ? (
          <Pressable
            style={[styles.discuss, { backgroundColor: theme.colors.pine, marginTop: 16 }]}
            onPress={() => void recoverTask()}
          >
            <Text
              style={{ color: theme.colors.onPine, fontWeight: "600", fontSize: theme.type.row }}
            >
              {currentTask.deletedAt ? "Restore task" : "Reopen task"}
            </Text>
          </Pressable>
        ) : null}
        <Text style={[styles.label, { color: theme.colors.ink }]}>Description</Text>
        <TextInput
          accessibilityLabel="Task description"
          value={notes}
          onChangeText={setNotes}
          onBlur={() => void saveNotes()}
          multiline
          style={[inputStyle, { minHeight: 112, textAlignVertical: "top", lineHeight: 24 }]}
          placeholder="Add a description"
          placeholderTextColor={theme.colors.muted}
        />

        <TaskTodosEditor
          key={currentTask.id}
          todos={currentTask.todos ?? []}
          onSave={(todos) => updateTask({ taskId, todos })}
        />

        <Text style={[styles.label, { color: theme.colors.ink }]}>Original estimate (minutes)</Text>
        <TextInput
          accessibilityLabel="Original task estimate in minutes"
          value={estimate}
          onChangeText={setEstimate}
          keyboardType="decimal-pad"
          onBlur={() => void savePlanningFields()}
          placeholder="No estimate"
          placeholderTextColor={theme.colors.muted}
          style={inputStyle}
        />
        <Text style={[styles.label, { color: theme.colors.ink }]}>Priority</Text>
        <ChoiceMenu
          field
          label={
            currentTask.priority
              ? currentTask.priority[0]!.toUpperCase() + currentTask.priority.slice(1)
              : "No priority"
          }
          accessibilityLabel="Task priority"
          groups={[
            {
              options: ([null, "high", "medium", "low"] as const).map((priority) => ({
                label: priority ? priority[0]!.toUpperCase() + priority.slice(1) : "No priority",
                selected: (currentTask.priority ?? null) === priority,
                onPress: () => void saveScheduling({ priority }),
              })),
            },
          ]}
        />
        <Text style={[styles.label, { color: theme.colors.ink }]}>Scheduled date</Text>
        <View style={styles.choiceRow}>
          {(
            [
              ["today", "Today"],
              ["this_week", "This week"],
              ["next_week", "Next week"],
              ["later", "Later"],
            ] as const
          ).map(([preset, label]) => (
            <Choice
              key={preset}
              label={label}
              active={scheduleGroup === preset}
              onPress={() => void schedule(preset)}
            />
          ))}
        </View>
        <View style={{ marginTop: 8 }}>
          <DateEditor
            label="Scheduled date"
            value={currentTask.scheduledDate ?? null}
            onSave={(scheduledDate) =>
              player.daily.scheduleTask(taskId, scheduledDate, player.date, player.timezone)
            }
            clearable
            showQuickChoices={false}
          />
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
          When you plan to work on this. This week picks Sunday; next week picks Monday.
        </Text>
        {fieldError ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {fieldError}
          </Text>
        ) : null}
        <Text style={[styles.label, { color: theme.colors.ink }]}>Due date</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
          An optional deadline, separate from when you plan to work.
        </Text>
        <DateEditor
          showQuickChoices={false}
          value={currentTask.dueDate}
          onSave={(dueDate) => updateTask({ taskId, dueDate })}
        />

        <Text style={[styles.label, { color: theme.colors.ink }]}>Status</Text>
        <View style={styles.choiceRow}>
          {STATUSES.map((status) => (
            <Choice
              key={status}
              label={status.replace("_", " ")}
              active={currentTask.status === status}
              onPress={() => void setStatus(status)}
              disabled={interaction.pending || currentTask.deletedAt !== null}
            />
          ))}
        </View>

        {interaction.error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {interaction.error}
          </Text>
        ) : null}

        <Text style={[styles.label, { color: theme.colors.ink }]}>Project</Text>
        <View style={styles.choiceRow}>
          <Choice
            label="Unassigned"
            active={currentTask.projectId === null}
            onPress={() => void setProject(null)}
          />
          {projects.map((item) => (
            <Choice
              key={item.id}
              label={item.title}
              active={currentTask.projectId === item.id}
              onPress={() => void setProject(ProjectIdSchema.make(item.id))}
            />
          ))}
        </View>
        {project ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open project: ${project.title}`}
            onPress={() => navigation.openProject(project.id)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta }}>
              Open project: {project.title}
              {project.archivedAt ? " (archived)" : ""}
            </Text>
          </Pressable>
        ) : null}

        <Text style={[styles.label, { color: theme.colors.ink, marginTop: 28 }]}>History</Text>
        {history.length === 0 ? (
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
            No history yet.
          </Text>
        ) : (
          history.map((event, index) => (
            <Row
              key={event.id}
              title={event.type}
              subtitle={[
                event.type === "task.updated" ? Object.keys(event.set).join(", ") : null,
                event.reason,
                event.at,
              ]
                .filter(Boolean)
                .join(" · ")}
              last={index === history.length - 1}
              style={{ marginHorizontal: -theme.space.screenX }}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function Choice(props: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="radio"
      accessibilityState={{ disabled: props.disabled, selected: props.active }}
      style={[
        styles.choice,
        {
          backgroundColor: props.active ? theme.colors.pineSoft : theme.colors.surface,
          borderColor: props.active ? theme.colors.pine : theme.colors.line,
          minHeight: 44,
        },
      ]}
    >
      <Text
        style={{
          color: props.active ? theme.colors.pine : theme.colors.ink,
          fontSize: theme.type.meta,
          fontWeight: "600",
          textTransform: "capitalize",
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 8,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choice: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
  },
  discuss: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 10,
  },
});
