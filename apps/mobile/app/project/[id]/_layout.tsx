import { Tabs, useLocalSearchParams } from "expo-router";

import { useFoldedState } from "../../../src/state/atoms";
import { selectProject } from "../../../src/state/selectors";
import { colors } from "../../../src/theme/colors";

export default function ProjectLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folded = useFoldedState();
  const project = id ? selectProject(folded, id) : undefined;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{ title: "Tasks", href: `/project/${id}/tasks` }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: "Chats", href: `/project/${id}/chats` }}
      />
      <Tabs.Screen
        name="handbook"
        options={{ title: "Handbook", href: `/project/${id}/handbook` }}
      />
      <Tabs.Screen
        name="context"
        options={{
          title: project ? `Context` : "Context",
          href: `/project/${id}/context`,
        }}
      />
    </Tabs>
  );
}
