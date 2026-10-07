import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { colors } from "../../src/theme/colors";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: styles.tabBar,
        sceneStyle: styles.scene,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Now" }} />
      <Tabs.Screen name="triage" options={{ title: "Triage" }} />
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: "#ffffff",
    borderTopColor: colors.border,
    height: 56,
  },
  scene: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
