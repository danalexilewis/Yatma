import { buildContext, contextText } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useFoldedState } from "../../state/atoms";
import {
  selectChats,
  selectPages,
  selectProject,
  selectProjectTasks,
} from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { EmptyState, Row, Screen } from "../../ui";

function useProject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folded = useFoldedState();
  const project = id ? selectProject(folded, id) : undefined;
  return { id, folded, project };
}

export function ProjectTasksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id, folded, project } = useProject();
  const tasks = id ? selectProjectTasks(folded, id) : [];

  if (!project) return <MissingProject />;

  return (
    <Screen edges={[]}>
      <ScrollView>
        {tasks.length === 0 ? (
          <EmptyState message="No open tasks." />
        ) : (
          tasks.map((task, index) => (
            <Row
              key={task.id}
              title={task.title}
              subtitle={task.status.replace("_", " ")}
              last={index === tasks.length - 1}
              onPress={() => router.push(`/task/${task.id}`)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export function ProjectChatsScreen() {
  const router = useRouter();
  const { id, folded, project } = useProject();
  const chats = selectChats(folded).filter((chat) => chat.projectId === id);

  if (!project) return <MissingProject />;

  return (
    <Screen edges={[]}>
      <ScrollView>
        {chats.length === 0 ? (
          <EmptyState message="No project chats yet." />
        ) : (
          chats.map((chat, index) => (
            <Row
              key={chat.id}
              title={chat.title ?? "Untitled chat"}
              last={index === chats.length - 1}
              onPress={() => router.push(`/chat/${chat.id}`)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export function ProjectHandbookScreen() {
  const router = useRouter();
  const { id, folded, project } = useProject();
  const pages = selectPages(folded, id).filter((page) => page.kind === "page");

  if (!project) return <MissingProject />;

  return (
    <Screen edges={[]}>
      <ScrollView>
        {pages.length === 0 ? (
          <EmptyState message="Handbook is empty." />
        ) : (
          pages.map((page, index) => (
            <Row
              key={page.id}
              title={page.title}
              last={index === pages.length - 1}
              onPress={() => router.push(`/page/${page.id}`)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export function ProjectContextScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id, folded, project } = useProject();
  const briefs = selectPages(folded, id).filter((page) => page.kind === "brief");
  const pinned = selectPages(folded, id).filter((page) => page.pinned);

  if (!project || !id) return <MissingProject />;

  const built = buildContext({
    today: new Date().toISOString().slice(0, 10),
    projects: folded.projects,
    tasks: folded.tasks,
    pages: folded.pages,
    chats: folded.chats,
    projectId: project.id,
    chatId: null,
    tokenBudget: 6_000,
  });
  const text = contextText(built);

  return (
    <Screen edges={[]} scroll contentStyle={{ paddingHorizontal: theme.space.screenX }}>
      <Text style={[styles.section, { color: theme.colors.muted }]}>Brief</Text>
      {briefs.map((page) => (
        <Row
          key={page.id}
          title={page.title}
          onPress={() => router.push(`/page/${page.id}`)}
          style={{ marginHorizontal: -theme.space.screenX }}
        />
      ))}
      {briefs.length === 0 ? (
        <Text style={{ color: theme.colors.muted, marginBottom: 12 }}>No brief yet.</Text>
      ) : null}

      <Text style={[styles.section, { color: theme.colors.muted, marginTop: 16 }]}>
        Pinned pages
      </Text>
      {pinned.map((page) => (
        <Text
          key={page.id}
          style={{ color: theme.colors.ink, fontSize: theme.type.row, marginBottom: 6 }}
        >
          {page.title}
        </Text>
      ))}
      {pinned.length === 0 ? (
        <Text style={{ color: theme.colors.muted, marginBottom: 12 }}>None pinned.</Text>
      ) : null}

      <Text style={[styles.section, { color: theme.colors.muted, marginTop: 16 }]}>
        Agent context meter
      </Text>
      <View style={[styles.meter, { backgroundColor: theme.colors.pineSoft }]}>
        <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>
          ≈ {built.estimatedTokens} tokens
          {built.trimmed.tasks || built.trimmed.pages
            ? ` · trimmed ${built.trimmed.tasks} tasks / ${built.trimmed.pages} pages`
            : ""}
        </Text>
      </View>

      <Text style={[styles.section, { color: theme.colors.muted, marginTop: 16 }]}>
        Exact model context
      </Text>
      <Text
        style={{
          color: theme.colors.ink,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 18,
          marginBottom: 32,
        }}
      >
        {text}
      </Text>
    </Screen>
  );
}

function MissingProject() {
  const theme = useTheme();
  return (
    <View style={[styles.missing, { backgroundColor: theme.colors.canvas }]}>
      <Text style={{ color: theme.colors.muted }}>Project not found</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  meter: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
