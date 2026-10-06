import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectActiveProjects, selectProjectTasks } from "../../state/selectors";
import { colors } from "../../theme/colors";

/** Project list → project tabs, with local create. */
export function ProjectsScreen() {
  const router = useRouter();
  const folded = useFoldedState();
  const { createProject } = useAppStore();
  const projects = selectActiveProjects(folded);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  async function onCreate() {
    const next = title.trim();
    if (!next) return;
    await createProject({ title: next });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTitle("");
    setCreating(false);
  }

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-50">Projects</Text>
        <Pressable
          onPress={() => setCreating((open) => !open)}
          className="rounded-full px-3 py-1.5"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-sm font-medium text-white">
            {creating ? "Cancel" : "New"}
          </Text>
        </Pressable>
      </View>

      {creating ? (
        <View className="mb-3 flex-row gap-2">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Project title"
            placeholderTextColor={colors.muted}
            className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            onSubmitEditing={() => void onCreate()}
            autoFocus
          />
          <Pressable
            onPress={() => void onCreate()}
            className="justify-center rounded-2xl px-3"
            style={{ backgroundColor: colors.brand }}
          >
            <Text className="font-medium text-white">Create</Text>
          </Pressable>
        </View>
      ) : null}

      {projects.length === 0 ? (
        <Text className="mt-8 text-center text-slate-500">No projects yet.</Text>
      ) : (
        projects.map((project) => {
          const openCount = selectProjectTasks(folded, project.id).length;
          return (
            <Pressable
              key={project.id}
              onPress={() => router.push(`/project/${project.id}/tasks`)}
              className="mb-2 flex-row items-center rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <View
                className="mr-3 h-3 w-3 rounded-full"
                style={{ backgroundColor: project.color ?? colors.brand }}
              />
              <View className="flex-1">
                <Text className="text-base font-medium text-slate-900 dark:text-slate-50">
                  {project.title}
                </Text>
                <Text className="text-xs text-slate-500">{openCount} open</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
