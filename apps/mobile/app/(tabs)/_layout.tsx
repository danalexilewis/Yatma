import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, useColorScheme } from "react-native";

import { createTheme } from "../../src/theme/theme";

function TabIcon(props: {
  readonly name: keyof typeof Ionicons.glyphMap;
  readonly color: string;
  readonly size: number;
}) {
  return <Ionicons name={props.name} size={props.size} color={props.color} />;
}

export default function TabsLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = createTheme(scheme);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.pine,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        sceneStyle: {
          flex: 1,
          backgroundColor: theme.colors.canvas,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Now",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="list-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="triage"
        options={{
          title: "Triage",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="grid-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="chatbubble-ellipses-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="folder-outline" size={size} color={String(color)} />
          ),
        }}
      />
    </Tabs>
  );
}
