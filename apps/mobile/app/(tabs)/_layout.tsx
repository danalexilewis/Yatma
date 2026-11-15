import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, useColorScheme } from "react-native";

import { createTheme } from "../../src/theme/theme";
import { useDesktopLayout } from "../../src/ui/useDesktopLayout";

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
  const desktop = useDesktopLayout();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.pine,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          display: desktop ? "none" : "flex",
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
          title: "Conversations",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="chatbubble-ellipses-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="play-circle-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="checkbox-outline" color={String(color)} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="routines"
        options={{
          href: null,
          title: "Routines",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="repeat-outline" color={String(color)} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="menu-outline" color={String(color)} size={size} />
          ),
        }}
      />
      <Tabs.Screen name="triage" options={{ href: null }} />
      <Tabs.Screen
        name="chat"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          href: null,
          title: "Projects",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="folder-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          title: "Settings",
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="settings-outline" size={size} color={String(color)} />
          ),
        }}
      />
    </Tabs>
  );
}
