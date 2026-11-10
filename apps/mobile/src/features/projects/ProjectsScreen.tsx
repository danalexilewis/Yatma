import { localCalendarDate, projectHealth } from "@yatma/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { useTheme } from "../../theme/theme";
import { EmptyState, IconButton, Row, Screen, ScreenHeader } from "../../ui";

/** Project list → project sections, with local create. */
export function ProjectsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const store = useAppStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visibleProjects = [...folded.projects.values()]
    .filter((project) => (project.archivedAt !== null) === showArchived)
    .toSorted((a, b) => a.title.localeCompare(b.title));
  const recoveryTasks = [...folded.tasks.values()]
    .filter((task) => task.deletedAt !== null || task.status === "done")
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  async function runCommand(command: Parameters<typeof store.executeLocalCommands>[0][number]) {
    try {
      await store.executeLocalCommands([command]);
    } catch (error) {
      Alert.alert("Could not save", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function onCreate() {
    const next = title.trim();
    if (!next) return;
    try {
      await store.createProject({ title: next });
    } catch (error) {
      Alert.alert(
        "Could not create project",
        error instanceof Error ? error.message : "Try again.",
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTitle("");
    setCreating(false);
  }

  return (
    <Screen>
      <ScreenHeader
        title={showRecovery ? "Completed & deleted" : "Projects"}
        trailing={
          <IconButton
            name={creating ? "close" : "add"}
            accessibilityLabel={creating ? "Cancel" : "New project"}
            color={theme.colors.pine}
            onPress={() => setCreating((open) => !open)}
          />
        }
      />

      <View style={styles.filters}>
        <Pressable onPress={() => setShowRecovery(false)}>
          <Text style={{ color: !showRecovery ? theme.colors.pine : theme.colors.muted }}>
            Projects
          </Text>
        </Pressable>
        <Pressable onPress={() => setShowRecovery(true)}>
          <Text style={{ color: showRecovery ? theme.colors.pine : theme.colors.muted }}>
            Completed & deleted
          </Text>
        </Pressable>
        {!showRecovery ? (
          <Pressable onPress={() => setShowArchived((value) => !value)}>
            <Text style={{ color: theme.colors.pine }}>{showArchived ? "Archived" : "Active"}</Text>
          </Pressable>
        ) : null}
      </View>

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
        {showRecovery ? (
          recoveryTasks.length === 0 ? (
            <EmptyState message="No completed or deleted tasks." />
          ) : (
            recoveryTasks.map((task, index) => (
              <Row
                key={task.id}
                title={task.title}
                subtitle={task.deletedAt ? "Deleted" : "Completed"}
                last={index === recoveryTasks.length - 1}
                onPress={() => router.push(`/task/${task.id}`)}
              />
            ))
          )
        ) : visibleProjects.length === 0 ? (
          <EmptyState
            message={showArchived ? "No archived projects." : "No projects yet."}
            actionLabel="New project"
            onAction={() => setCreating(true)}
          />
        ) : (
          visibleProjects.map((project, index) => {
            const health = projectHealth(
              project,
              [...folded.tasks.values()],
              localCalendarDate(new Date()),
            );
            const editing = editingId === project.id;
            return (
              <View key={project.id}>
                {editing ? (
                  <View style={styles.editRow}>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      onSubmitEditing={() => {
                        const next = title.trim();
                        if (next && next !== project.title)
                          void runCommand({
                            type: "project.update",
                            input: { projectId: project.id, title: next },
                          });
                        setEditingId(null);
                      }}
                      autoFocus
                      style={{ flex: 1, color: theme.colors.ink, minHeight: theme.touch }}
                    />
                    <Pressable
                      onPress={() => {
                        setEditingId(null);
                        setTitle("");
                      }}
                    >
                      <Text style={{ color: theme.colors.muted }}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Row
                    title={project.title}
                    subtitle={`${health.label} · ${health.open.length} open${health.overdue.length ? ` · ${health.overdue.length} overdue` : ""}`}
                    last={index === visibleProjects.length - 1}
                    leading={
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: project.color ?? theme.colors.pine },
                        ]}
                      />
                    }
                    onPress={() => router.push(`/project/${project.id}/overview`)}
                    trailing={
                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => {
                            setEditingId(project.id);
                            setTitle(project.title);
                          }}
                        >
                          <Text style={{ color: theme.colors.pine }}>Edit</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            void runCommand({
                              type: "project.update",
                              input: { projectId: project.id, archived: !showArchived },
                            })
                          }
                        >
                          <Text style={{ color: theme.colors.pine }}>
                            {showArchived ? "Unarchive" : "Archive"}
                          </Text>
                        </Pressable>
                      </View>
                    }
                  />
                )}
              </View>
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
  filters: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 12 },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: "row", gap: 12 },
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
