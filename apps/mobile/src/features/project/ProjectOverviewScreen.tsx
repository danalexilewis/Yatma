import type { ProjectBookmark } from "@yatma/core";
import { localCalendarDate, projectHealth } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { selectProject } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { DateEditor, IconButton, Row, Screen } from "../../ui";
import type { ProjectTaskFilter } from "./ProjectTaskList";

const PROJECT_COLORS = ["#1F6B4A", "#2A5DB0", "#A16207", "#9854A0", "#C2413A", "#5C6B66"];

/** A project combines task health, editable context, target date, and saved resources. */
export function ProjectOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const store = useAppStore();
  const project = id ? selectProject(store.state.folded, id) : undefined;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [addingBookmark, setAddingBookmark] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project)
    return (
      <Screen>
        <Text style={{ color: theme.colors.muted, padding: 24 }}>Project not found.</Text>
      </Screen>
    );
  const current = project;
  const health = projectHealth(
    current,
    [...store.state.folded.tasks.values()],
    localCalendarDate(new Date()),
  );
  const attention = health.overdue.length > 0 || health.pastTarget;
  const bookmarks = current.bookmarks ?? [];

  function tasks(filter: ProjectTaskFilter) {
    router.push({ pathname: "/project/[id]/tasks", params: { id: current.id, filter } });
  }

  async function saveProperties() {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await store.executeLocalCommands([
        {
          type: "project.update",
          input: {
            projectId: current.id,
            title: title.trim(),
            description: description.trim(),
            color,
          },
        },
      ]);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save project properties.");
    } finally {
      setSaving(false);
    }
  }

  async function saveBookmarks(next: readonly ProjectBookmark[]) {
    setSaving(true);
    setError(null);
    try {
      await store.executeLocalCommands([
        { type: "project.update", input: { projectId: current.id, bookmarks: next } },
      ]);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save bookmarks.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addBookmark() {
    if (saving || !bookmarkUrl.trim()) return;
    let url: URL;
    try {
      url = new URL(bookmarkUrl.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      setError("Use a complete http:// or https:// link.");
      return;
    }
    const normalized = url.toString();
    const next = [
      ...bookmarks.filter((bookmark) => bookmark.url !== normalized),
      { title: bookmarkTitle.trim() || url.hostname, url: normalized },
    ];
    if (await saveBookmarks(next)) {
      setAddingBookmark(false);
      setBookmarkTitle("");
      setBookmarkUrl("");
    }
  }

  async function openBookmark(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError("Could not open this bookmark. Check the link and try again.");
    }
  }

  async function archive() {
    setError(null);
    try {
      await store.executeLocalCommands([
        {
          type: "project.update",
          input: { projectId: current.id, archived: current.archivedAt === null },
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the project.");
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View
          style={[
            styles.health,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
          ]}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>Project health</Text>
          <Text
            accessibilityRole="header"
            style={{
              color: attention ? theme.colors.danger : theme.colors.ink,
              fontSize: 27,
              fontWeight: "700",
              marginTop: 6,
            }}
          >
            {current.archivedAt ? "Archived" : health.label}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21, marginTop: 6 }}>
            {health.pastTarget
              ? "The target date has passed with work still outstanding."
              : health.overdue.length
                ? `${health.overdue.length} overdue ${health.overdue.length === 1 ? "task needs" : "tasks need"} a date review.`
                : health.total
                  ? `${health.completed} of ${health.total} tasks completed.`
                  : "Add tasks to start seeing progress."}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Completed project tasks"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(health.progress * 100) }}
            style={[styles.progressTrack, { backgroundColor: theme.colors.line }]}
          >
            <View
              style={{
                height: 5,
                width: `${Math.round(health.progress * 100)}%`,
                backgroundColor: theme.colors.pine,
                borderRadius: 3,
              }}
            />
          </View>
          <View style={styles.metrics}>
            {[
              { label: "Open", count: health.open.length, filter: "all" },
              { label: "Overdue", count: health.overdue.length, filter: "overdue" },
              { label: "Next 7 days", count: health.dueSoon.length, filter: "upcoming" },
            ].map((metric) => (
              <Pressable
                key={metric.label}
                accessibilityRole="button"
                accessibilityLabel={`View ${metric.label.toLowerCase()} project tasks`}
                onPress={() => tasks(metric.filter as ProjectTaskFilter)}
                style={styles.metric}
              >
                <Text
                  style={{
                    color:
                      metric.label === "Overdue" && metric.count
                        ? theme.colors.danger
                        : theme.colors.ink,
                    fontSize: 24,
                    fontWeight: "700",
                  }}
                >
                  {metric.count}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                  {metric.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {health.undated.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => tasks("undated")}
              style={styles.review}
            >
              <Text style={{ color: theme.colors.pine, fontSize: 14, fontWeight: "600" }}>
                Review {health.undated.length} {health.undated.length === 1 ? "task" : "tasks"}{" "}
                without a due date
              </Text>
              <Text style={{ color: theme.colors.pine }}>›</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.colors.ink }]}
          >
            Purpose & properties
          </Text>
          <IconButton
            name={editing ? "close-outline" : "create-outline"}
            accessibilityLabel={editing ? "Cancel project editing" : "Edit project properties"}
            color={theme.colors.pine}
            onPress={() => {
              if (!editing) {
                setTitle(current.title);
                setDescription(current.description ?? "");
                setColor(current.color);
              }
              setEditing(!editing);
            }}
          />
        </View>
        {editing ? (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Project name"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              style={[
                styles.input,
                {
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.line,
                },
              ]}
            />
            <TextInput
              accessibilityLabel="Project purpose"
              value={description}
              onChangeText={setDescription}
              placeholder="What does a good outcome look like?"
              placeholderTextColor={theme.colors.muted}
              multiline
              maxLength={2000}
              style={[
                styles.input,
                {
                  minHeight: 90,
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.line,
                },
              ]}
            />
            <View style={styles.colors}>
              {PROJECT_COLORS.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={`Project color ${value}`}
                  accessibilityState={{ selected: color === value }}
                  onPress={() => setColor(value)}
                  style={[
                    styles.colorTarget,
                    { borderColor: color === value ? theme.colors.ink : "transparent" },
                  ]}
                >
                  <View style={[styles.color, { backgroundColor: value }]} />
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save project properties"
              disabled={saving || !title.trim()}
              onPress={() => void saveProperties()}
              style={[styles.primary, { backgroundColor: theme.colors.pine }]}
            >
              <Text style={{ color: theme.colors.onPine, fontWeight: "600" }}>
                {saving ? "Saving…" : "Save properties"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text
            style={{
              color: current.description ? theme.colors.ink : theme.colors.muted,
              fontSize: 16,
              lineHeight: 24,
            }}
          >
            {current.description ||
              "Describe the outcome, constraints, or details that will help you plan this project."}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage project target date"
          onPress={() => setEditingTarget(!editingTarget)}
          style={styles.target}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 14 }}>Target date</Text>
          <Text style={{ color: theme.colors.pine, fontSize: 14 }}>
            {current.targetDate ?? "Set a target date"}
          </Text>
        </Pressable>
        {editingTarget ? (
          <DateEditor
            label="Project target date"
            value={current.targetDate ?? null}
            onSave={(targetDate) =>
              store.executeLocalCommands([
                { type: "project.update", input: { projectId: current.id, targetDate } },
              ])
            }
          />
        ) : null}

        <View style={styles.sectionHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.colors.ink }]}
          >
            Bookmarks
          </Text>
          <IconButton
            name={addingBookmark ? "close-outline" : "add-outline"}
            accessibilityLabel={addingBookmark ? "Cancel bookmark" : "Add bookmark"}
            color={theme.colors.pine}
            onPress={() => setAddingBookmark(!addingBookmark)}
          />
        </View>
        {bookmarks.map((bookmark) => (
          <View key={bookmark.url} style={styles.bookmark}>
            <IconButton
              name="link-outline"
              accessibilityLabel={`Open bookmark ${bookmark.title}`}
              color={theme.colors.pine}
              onPress={() => void openBookmark(bookmark.url)}
            />
            <Pressable
              accessibilityRole="link"
              onPress={() => void openBookmark(bookmark.url)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Text style={{ color: theme.colors.ink, fontSize: 16, fontWeight: "600" }}>
                {bookmark.title}
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}
              >
                {bookmark.url}
              </Text>
            </Pressable>
            <IconButton
              name="trash-outline"
              accessibilityLabel={`Remove bookmark ${bookmark.title}`}
              disabled={saving}
              color={theme.colors.muted}
              onPress={() =>
                void saveBookmarks(bookmarks.filter((item) => item.url !== bookmark.url))
              }
            />
          </View>
        ))}
        {!bookmarks.length && !addingBookmark ? (
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            Keep useful links, documents, and references with the project.
          </Text>
        ) : null}
        {addingBookmark ? (
          <View style={{ gap: 8 }}>
            <TextInput
              accessibilityLabel="Bookmark title"
              value={bookmarkTitle}
              onChangeText={setBookmarkTitle}
              placeholder="Title"
              placeholderTextColor={theme.colors.muted}
              maxLength={200}
              style={[
                styles.input,
                {
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.line,
                },
              ]}
            />
            <TextInput
              accessibilityLabel="Bookmark URL"
              value={bookmarkUrl}
              onChangeText={setBookmarkUrl}
              placeholder="https://…"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={2048}
              style={[
                styles.input,
                {
                  color: theme.colors.ink,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.line,
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save bookmark"
              disabled={saving || !bookmarkUrl.trim()}
              onPress={() => void addBookmark()}
              style={[styles.primary, { backgroundColor: theme.colors.pine }]}
            >
              <Text style={{ color: theme.colors.onPine, fontWeight: "600" }}>Save bookmark</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.colors.ink }]}
          >
            Next tasks
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => tasks("all")}
            style={styles.textAction}
          >
            <Text style={{ color: theme.colors.pine, fontSize: 13 }}>View all</Text>
          </Pressable>
        </View>
        {health.open.slice(0, 3).map((task, index) => (
          <Row
            key={task.id}
            title={task.title}
            subtitle={task.dueDate ? `Due ${task.dueDate}` : "No due date"}
            last={index === Math.min(health.open.length, 3) - 1}
            onPress={() => router.push(`/task/${task.id}`)}
            style={{ paddingHorizontal: 0 }}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.dismissTo({ pathname: "/", params: { projectId: current.id } })}
          style={[styles.primary, { backgroundColor: theme.colors.pineSoft, marginTop: 24 }]}
        >
          <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>Discuss this project</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void archive()}
          style={styles.textAction}
        >
          <Text style={{ color: theme.colors.muted }}>
            {current.archivedAt ? "Unarchive project" : "Archive project"}
          </Text>
        </Pressable>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 10 }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, maxWidth: 760, width: "100%", alignSelf: "center" },
  health: { padding: 18, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  progressTrack: { height: 5, borderRadius: 3, marginTop: 18, overflow: "hidden" },
  metrics: { flexDirection: "row", marginTop: 16 },
  metric: { flex: 1, paddingVertical: 8, minHeight: 60 },
  review: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 24,
  },
  sectionTitle: { fontSize: 19, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 44, padding: 12, fontSize: 15 },
  colors: { flexDirection: "row", gap: 4 },
  colorTarget: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  color: { width: 26, height: 26, borderRadius: 13 },
  primary: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  target: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  bookmark: { flexDirection: "row", alignItems: "center", minHeight: 64 },
  textAction: { minHeight: 44, justifyContent: "center", alignItems: "center" },
});
