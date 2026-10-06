import type { ProjectId, Quadrant, TaskStatus } from "@yatma/core";
import { ProjectId as ProjectIdSchema, TaskId as TaskIdSchema } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import {
  selectActiveProjects,
  selectProject,
  selectTask,
  selectTaskHistory,
} from "../../state/selectors";
import { colors } from "../../theme/colors";

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
  const folded = useFoldedState();
  const { updateTask } = useAppStore();
  const task = id ? selectTask(folded, id) : undefined;
  const project = task?.projectId ? selectProject(folded, task.projectId) : undefined;
  const projects = selectActiveProjects(folded);
  const history = id ? selectTaskHistory(folded, id) : [];

  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  if (task && draftKey !== task.id) {
    setDraftKey(task.id);
    setTitle(task.title);
    setNotes(task.notes ?? "");
  }

  if (!task) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Text className="text-slate-500">Task not found</Text>
      </View>
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

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <TextInput
        value={title}
        onChangeText={setTitle}
        onBlur={() => void saveTitle()}
        onSubmitEditing={() => void saveTitle()}
        className="text-2xl font-bold text-slate-900 dark:text-slate-50"
        placeholder="Title"
        placeholderTextColor={colors.muted}
      />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        onBlur={() => void saveNotes()}
        multiline
        className="mt-2 min-h-[72px] text-base text-slate-600 dark:text-slate-300"
        placeholder="Notes"
        placeholderTextColor={colors.muted}
      />

      <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Status</Text>
      <View className="flex-row flex-wrap gap-2">
        {STATUSES.map((status) => (
          <Chip
            key={status}
            label={status.replace("_", " ")}
            active={currentTask.status === status}
            onPress={() => void setStatus(status)}
          />
        ))}
      </View>

      <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Quadrant</Text>
      <View className="flex-row flex-wrap gap-2">
        {QUADRANTS.map((quadrant) => (
          <Chip
            key={quadrant}
            label={quadrant}
            active={(currentTask.quadrant ?? "inbox") === quadrant}
            onPress={() => void setQuadrant(quadrant)}
          />
        ))}
      </View>

      <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Project</Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="None"
          active={currentTask.projectId === null}
          onPress={() => void setProject(null)}
        />
        {projects.map((item) => (
          <Chip
            key={item.id}
            label={item.title}
            active={currentTask.projectId === item.id}
            onPress={() => void setProject(ProjectIdSchema.make(item.id))}
          />
        ))}
      </View>

      {project ? (
        <Text className="mt-2 text-xs text-slate-500">Current: {project.title}</Text>
      ) : null}

      <Pressable
        className="mt-4 self-start rounded-full px-4 py-2"
        style={{ backgroundColor: colors.brand }}
        onPress={() =>
          router.push({
            pathname: "/(tabs)/chat",
            params: { taskId: currentTask.id },
          })
        }
      >
        <Text className="font-medium text-white">Discuss</Text>
      </Pressable>

      <Text className="mb-2 mt-6 text-sm font-semibold text-slate-700 dark:text-slate-200">
        History
      </Text>
      {history.length === 0 ? (
        <Text className="text-sm text-slate-500">No history yet.</Text>
      ) : (
        history.map((event) => (
          <View
            key={event.id}
            className="mb-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <Text className="text-sm text-slate-800 dark:text-slate-100">{event.type}</Text>
            {event.type === "task.updated" ? (
              <Text className="mt-1 text-xs text-slate-500">
                {Object.keys(event.set).join(", ")}
              </Text>
            ) : null}
            {event.reason ? (
              <Text className="mt-1 text-xs text-slate-500">{event.reason}</Text>
            ) : null}
            <Text className="mt-1 text-xs text-slate-400">{event.at}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Chip(props: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      className="rounded-full px-3 py-1.5"
      style={{
        backgroundColor: props.active ? colors.brand : `${colors.brand}14`,
      }}
    >
      <Text
        className="text-xs font-medium capitalize"
        style={{ color: props.active ? "#fff" : colors.brand }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
