import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectActiveProjects, selectProjectTasks } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { EmptyState, IconButton, Row, Screen, ScreenHeader } from "../../ui";

/** Project list → project sections, with local create. */
export function ProjectsScreen() {
  const router = useRouter();
  const theme = useTheme();
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
    <Screen>
      <ScreenHeader
        title="Projects"
        trailing={
          <IconButton
            name={creating ? "close" : "add"}
            accessibilityLabel={creating ? "Cancel" : "New project"}
            color={theme.colors.pine}
            onPress={() => setCreating((open) => !open)}
          />
        }
      />

      {creating ? (
        <View
          style={[
            styles.createRow,
            {
              borderBottomColor: theme.colors.line,
              paddingHorizontal: theme.space.screenX,
            },
          ]}
        >
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Project title"
            placeholderTextColor={theme.colors.muted}
            style={{
              flex: 1,
              color: theme.colors.ink,
              fontSize: theme.type.row,
              minHeight: theme.touch,
            }}
            onSubmitEditing={() => void onCreate()}
            autoFocus
            returnKeyType="done"
          />
          <Pressable
            onPress={() => void onCreate()}
            style={[styles.createBtn, { backgroundColor: theme.colors.pine }]}
          >
            <Text style={{ color: theme.colors.onPine, fontWeight: "600" }}>Create</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {projects.length === 0 ? (
          <EmptyState
            message="No projects yet."
            actionLabel="New project"
            onAction={() => setCreating(true)}
          />
        ) : (
          projects.map((project, index) => {
            const openCount = selectProjectTasks(folded, project.id).length;
            return (
              <Row
                key={project.id}
                title={project.title}
                subtitle={`${openCount} open`}
                last={index === projects.length - 1}
                leading={
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: project.color ?? theme.colors.pine },
                    ]}
                  />
                }
                onPress={() => router.push(`/project/${project.id}/tasks`)}
              />
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  createBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
  },
  list: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
