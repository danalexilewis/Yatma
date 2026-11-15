import { Ionicons } from "@expo/vector-icons";
import type { Project, ProjectId, TaskCatalogFilter } from "@yatma/core";
import { useState } from "react";
import { ChoiceMenu, type ChoiceMenuGroup } from "../../ui/ChoiceMenu";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { useTheme } from "../../theme/theme";
import { IconButton } from "../../ui";

export function TaskToolbar(props: {
  query: string;
  onQuery: (value: string) => void;
  status: TaskCatalogFilter["status"];
  onStatus: (value: TaskCatalogFilter["status"]) => void;
  sort: TaskCatalogFilter["sort"];
  onSort: (value: TaskCatalogFilter["sort"]) => void;
  scheduled: NonNullable<TaskCatalogFilter["scheduled"]>;
  onScheduled: (value: NonNullable<TaskCatalogFilter["scheduled"]>) => void;
  due: TaskCatalogFilter["due"];
  onDue: (value: TaskCatalogFilter["due"]) => void;
  projectId: ProjectId | null | undefined;
  onProject: (value: ProjectId | null | undefined) => void;
  scoped: boolean;
  projects: Project[];
  count: number;
  selected: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onAssign: (id: ProjectId | null) => void;
  selectedProject: ProjectId | null | undefined;
  busy: boolean;
  onCreate: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [searching, setSearching] = useState(false);
  const compact = width < 700;
  const statusLabels = {
    open: "Open tasks",
    all: "All tasks",
    done: "Completed",
    deleted: "Deleted",
  };
  const sortLabels = {
    priority: "Priority",
    title: "Title",
    scheduled: "Scheduled date",
    due: "Due date",
    updated: "Recently updated",
  };
  const dueLabels = {
    all: "Any date",
    today: "Due today",
    upcoming: "Next 7 days",
    overdue: "Overdue",
    undated: "No due date",
  };
  const scheduledLabels = {
    all: "Any schedule",
    today: "Today",
    this_week: "This week",
    next_week: "Next week",
    later: "Later",
  };
  const filterCount =
    Number(props.scheduled !== "all") +
    Number(props.due !== "all") +
    Number(!props.scoped && props.projectId !== undefined);
  const groups: ChoiceMenuGroup[] = [
    {
      title: "Scheduled",
      options: (Object.keys(scheduledLabels) as NonNullable<TaskCatalogFilter["scheduled"]>[]).map(
        (value) => ({
          label: scheduledLabels[value],
          selected: props.scheduled === value,
          onPress: () => props.onScheduled(value),
        }),
      ),
    },
    {
      title: "Due date",
      options: (Object.keys(dueLabels) as TaskCatalogFilter["due"][]).map((value) => ({
        label: dueLabels[value],
        selected: props.due === value,
        onPress: () => props.onDue(value),
      })),
    },
  ];
  if (!props.scoped)
    groups.unshift({
      title: "Project",
      options: [
        {
          label: "All projects",
          selected: props.projectId === undefined,
          onPress: () => props.onProject(undefined),
        },
        {
          label: "No project",
          selected: props.projectId === null,
          onPress: () => props.onProject(null),
        },
        ...props.projects.map((project) => ({
          label: `${project.title}${project.archivedAt ? " (archived)" : ""}`,
          selected: props.projectId === project.id,
          onPress: () => props.onProject(project.id),
        })),
      ],
    });
  if (filterCount)
    groups.push({
      options: [
        {
          label: "Clear filters",
          onPress: () => {
            props.onDue("all");
            props.onScheduled("all");
            props.onProject(undefined);
          },
        },
      ],
    });
  const search = (
    <View
      style={[
        styles.search,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
        compact && { flex: 1 },
      ]}
    >
      <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
      <TextInput
        autoFocus={compact}
        accessibilityLabel="Search tasks"
        placeholder="Search"
        placeholderTextColor={theme.colors.muted}
        value={props.query}
        onChangeText={props.onQuery}
        style={{ flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: 13, padding: 0 }}
      />
    </View>
  );
  return (
    <View
      style={[
        styles.toolbar,
        { borderColor: theme.colors.line },
        compact && { paddingHorizontal: 8, gap: 0 },
      ]}
    >
      {props.selected ? (
        <>
          <IconButton
            name="close-outline"
            accessibilityLabel="Clear selection"
            onPress={props.onClear}
            size={18}
          />
          <Text style={{ color: theme.colors.ink, fontSize: 13 }}>{props.selected} selected</Text>
          <View style={{ flex: 1 }} />
          <ChoiceMenu
            label="Assign project"
            disabled={props.busy}
            groups={[
              {
                options: [
                  {
                    label: "No project",
                    selected: props.selectedProject === null,
                    onPress: () => props.onAssign(null),
                  },
                  ...props.projects
                    .filter((project) => !project.archivedAt)
                    .map((project) => ({
                      label: project.title,
                      selected: props.selectedProject === project.id,
                      onPress: () => props.onAssign(project.id),
                    })),
                ],
              },
            ]}
          />
        </>
      ) : compact && searching ? (
        <>
          {search}
          <IconButton
            name="close-outline"
            accessibilityLabel="Close search"
            onPress={() => setSearching(false)}
          />
        </>
      ) : (
        <>
          {!compact ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Select all visible tasks"
              accessibilityState={{
                checked: props.allSelected,
                disabled: props.busy || !props.count,
              }}
              disabled={props.busy || !props.count}
              onPress={props.onSelectAll}
              style={styles.select}
              {...(Platform.OS === "web" ? { dataSet: { tooltip: "Select all" } } : {})}
            >
              <Ionicons
                name={props.allSelected ? "checkbox" : "square-outline"}
                size={17}
                color={theme.colors.muted}
              />
            </Pressable>
          ) : null}
          <ChoiceMenu
            label={compact && props.status === "open" ? "Open" : statusLabels[props.status]}
            groups={[
              {
                options: (Object.keys(statusLabels) as TaskCatalogFilter["status"][]).map(
                  (value) => ({
                    label: statusLabels[value],
                    selected: props.status === value,
                    onPress: () => props.onStatus(value),
                  }),
                ),
              },
            ]}
          />
          {!compact ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{props.count}</Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {compact ? (
            <IconButton
              name="search-outline"
              accessibilityLabel="Search tasks"
              onPress={() => setSearching(true)}
              size={18}
              color={props.query ? theme.colors.pine : theme.colors.muted}
            />
          ) : (
            search
          )}
          <ChoiceMenu
            label={`Filter${filterCount ? ` · ${filterCount}` : ""}`}
            active={filterCount > 0}
            groups={groups}
          />
          <ChoiceMenu
            label="Sort"
            accessibilityLabel={`Sort: ${sortLabels[props.sort]}`}
            active={props.sort !== "priority"}
            groups={[
              {
                title: "Sort by",
                options: (Object.keys(sortLabels) as TaskCatalogFilter["sort"][]).map((value) => ({
                  label: sortLabels[value],
                  selected: props.sort === value,
                  onPress: () => props.onSort(value),
                })),
              },
            ]}
          />
          {compact ? (
            <IconButton
              name="add-outline"
              accessibilityLabel="Add task"
              onPress={props.onCreate}
              color={theme.colors.pine}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={props.onCreate}
              style={[styles.button, { backgroundColor: theme.colors.pineSoft, marginLeft: 8 }]}
            >
              <Ionicons name="add" size={16} color={theme.colors.pine} />
              <Text style={{ color: theme.colors.pine, fontSize: 13, fontWeight: "600" }}>
                Add task
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  toolbar: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  select: { width: 32, minHeight: 44, alignItems: "center", justifyContent: "center" },
  search: {
    width: 180,
    height: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    marginRight: 8,
  },
});
