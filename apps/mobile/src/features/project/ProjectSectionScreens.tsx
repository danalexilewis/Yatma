import { buildContext, contextText } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useFoldedState } from "../../state/atoms";
import {
  selectChats,
  selectPages,
  selectProject,
  selectProjectTasks,
} from "../../state/selectors";
import { colors } from "../../theme/colors";

function useProject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folded = useFoldedState();
  const project = id ? selectProject(folded, id) : undefined;
  return { id, folded, project };
}

export function ProjectTasksScreen() {
  const router = useRouter();
  const { id, folded, project } = useProject();
  const tasks = id ? selectProjectTasks(folded, id) : [];

  if (!project) return <MissingProject />;

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      {tasks.map((task) => (
        <Pressable
          key={task.id}
          onPress={() => router.push(`/task/${task.id}`)}
          className="mb-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <Text className="text-base text-slate-900 dark:text-slate-50">{task.title}</Text>
        </Pressable>
      ))}
      {tasks.length === 0 ? <Text className="text-slate-500">No open tasks.</Text> : null}
    </ScrollView>
  );
}

export function ProjectChatsScreen() {
  const router = useRouter();
  const { id, folded, project } = useProject();
  const chats = selectChats(folded).filter((chat) => chat.projectId === id);

  if (!project) return <MissingProject />;

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      {chats.map((chat) => (
        <Pressable
          key={chat.id}
          onPress={() => router.push(`/chat/${chat.id}`)}
          className="mb-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <Text className="text-base text-slate-900 dark:text-slate-50">
            {chat.title ?? "Untitled chat"}
          </Text>
        </Pressable>
      ))}
      {chats.length === 0 ? <Text className="text-slate-500">No project chats yet.</Text> : null}
    </ScrollView>
  );
}

export function ProjectHandbookScreen() {
  const router = useRouter();
  const { id, folded, project } = useProject();
  const pages = selectPages(folded, id).filter((page) => page.kind === "page");

  if (!project) return <MissingProject />;

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      {pages.map((page) => (
        <Pressable
          key={page.id}
          onPress={() => router.push(`/page/${page.id}`)}
          className="mb-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <Text className="text-base text-slate-900 dark:text-slate-50">{page.title}</Text>
        </Pressable>
      ))}
      {pages.length === 0 ? <Text className="text-slate-500">Handbook is empty.</Text> : null}
    </ScrollView>
  );
}

export function ProjectContextScreen() {
  const router = useRouter();
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
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <Text className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Brief</Text>
      {briefs.map((page) => (
        <Pressable key={page.id} onPress={() => router.push(`/page/${page.id}`)}>
          <Text className="mb-3 text-base text-slate-800 dark:text-slate-100">{page.title}</Text>
        </Pressable>
      ))}
      {briefs.length === 0 ? <Text className="mb-3 text-slate-500">No brief yet.</Text> : null}

      <Text className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Pinned pages
      </Text>
      {pinned.map((page) => (
        <Text key={page.id} className="mb-1 text-sm text-slate-700 dark:text-slate-200">
          {page.title}
        </Text>
      ))}
      {pinned.length === 0 ? <Text className="mb-3 text-slate-500">None pinned.</Text> : null}

      <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Agent context meter
      </Text>
      <View className="mb-3 rounded-2xl px-3 py-3" style={{ backgroundColor: `${colors.brand}18` }}>
        <Text style={{ color: colors.brand }}>
          ≈ {built.estimatedTokens} tokens
          {built.trimmed.tasks || built.trimmed.pages
            ? ` · trimmed ${built.trimmed.tasks} tasks / ${built.trimmed.pages} pages`
            : ""}
        </Text>
      </View>

      <Text className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Exact model context
      </Text>
      <Text className="mb-8 font-mono text-xs leading-5 text-slate-700 dark:text-slate-200">
        {text}
      </Text>
    </ScrollView>
  );
}

function MissingProject() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Text className="text-slate-500">Project not found</Text>
    </View>
  );
}
