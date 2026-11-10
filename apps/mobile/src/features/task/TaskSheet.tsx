import type { ProjectId, Quadrant, TaskStatus } from "@yatma/core";
import { ProjectId as ProjectIdSchema, TaskId as TaskIdSchema, quadrantLabel } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import {
  selectActiveProjects,
  selectProject,
  selectTask,
  selectTaskHistory,
} from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { DateEditor, Row, Screen } from "../../ui";

const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];
const QUADRANTS: ReadonlyArray<Quadrant | "inbox"> = [
  "inbox",
  "do",
  "schedule",
  "delegate",
  "eliminate",
];

/** Task detail: editable fields, project, history, Discuss → chat. */
export function TaskSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const store = useAppStore();
  const { updateTask } = store;
  const task = id ? selectTask(folded, id) : undefined;
  const project = task?.projectId ? selectProject(folded, task.projectId) : undefined;
  const projects = selectActiveProjects(folded);
  const history = id ? selectTaskHistory(folded, id) : [];

  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (task && draftKey !== task.id) {
    setDraftKey(task.id);
    setTitle(task.title);
    setNotes(task.notes ?? "");
  }

  if (!task) {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.muted }}>Task not found</Text>
        </View>
      </Screen>
    );
  }

  const currentTask = task;
  const taskId = TaskIdSchema.make(currentTask.id);

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
    await updateTask({ taskId, status });
  }

  async function setQuadrant(value: Quadrant | "inbox") {
    const quadrant = value === "inbox" ? null : value;
    if (quadrant === currentTask.quadrant) return;
    await updateTask({ taskId, quadrant });
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
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete the task.");
    } finally {
      setDeleting(false);
    }
  }

  async function recoverTask() {
    try {
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
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space.screenX,
          paddingBottom: 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => void saveTitle()}
          onSubmitEditing={() => void saveTitle()}
          style={{
            color: theme.colors.ink,
            fontSize: 24,
            fontWeight: "700",
            marginTop: 8,
          }}
          placeholder="Title"
          placeholderTextColor={theme.colors.muted}
        />

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
        <TextInput
          value={notes}
          onChangeText={setNotes}
          onBlur={() => void saveNotes()}
          multiline
          style={{
            color: theme.colors.muted,
            fontSize: theme.type.row,
            marginTop: 8,
            minHeight: 72,
          }}
          placeholder="Notes"
          placeholderTextColor={theme.colors.muted}
        />

        <Text style={[styles.label, { color: theme.colors.muted }]}>Due date</Text>
        <DateEditor
          value={currentTask.dueDate}
          onSave={(dueDate) => updateTask({ taskId, dueDate })}
        />

        <Text style={[styles.label, { color: theme.colors.muted }]}>Status</Text>
        <View style={styles.choiceRow}>
          {STATUSES.map((status) => (
            <Choice
              key={status}
              label={status.replace("_", " ")}
              active={currentTask.status === status}
              onPress={() => void setStatus(status)}
            />
          ))}
        </View>

        <Text style={[styles.label, { color: theme.colors.muted }]}>Urgency & importance</Text>
        <View style={styles.choiceRow}>
          {QUADRANTS.map((quadrant) => (
            <Choice
              key={quadrant}
              label={quadrantLabel(quadrant === "inbox" ? null : quadrant)}
              active={(currentTask.quadrant ?? "inbox") === quadrant}
              onPress={() => void setQuadrant(quadrant)}
            />
          ))}
        </View>

        <Text style={[styles.label, { color: theme.colors.muted }]}>Project</Text>
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
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 4 }}>
            Current: {project.title}
          </Text>
        ) : null}

        <Pressable
          style={[styles.discuss, { backgroundColor: theme.colors.pine, marginTop: 20 }]}
          onPress={() =>
            router.dismissTo({
              pathname: "/",
              params: { taskId: currentTask.id },
            })
          }
        >
          <Text style={{ color: theme.colors.onPine, fontWeight: "600", fontSize: theme.type.row }}>
            Discuss
          </Text>
        </Pressable>

        {!currentTask.deletedAt ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete task"
            disabled={deleting}
            onPress={() => void deleteTask()}
            style={[styles.discuss, { marginTop: 12 }]}
          >
            <Text style={{ color: theme.colors.danger, fontWeight: "600", fontSize: theme.type.row }}>
              Delete task
            </Text>
          </Pressable>
        ) : null}
        {deleteError ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{deleteError}</Text> : null}

        <Text style={[styles.label, { color: theme.colors.muted, marginTop: 28 }]}>History</Text>
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
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.choice,
        {
          backgroundColor: props.active ? theme.colors.pine : theme.colors.pineSoft,
          minHeight: 36,
        },
      ]}
    >
      <Text
        style={{
          color: props.active ? theme.colors.onPine : theme.colors.pine,
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
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
  },
  discuss: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
});
