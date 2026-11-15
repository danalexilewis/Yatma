import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../../src/theme/theme";
import { Screen, ScreenHeader } from "../../src/ui";

const destinations = [
  { label: "Projects", icon: "folder-outline", href: "/projects" },
  { label: "Skills", icon: "sparkles-outline", href: "/skills" },
  { label: "Routines", icon: "repeat-outline", href: "/routines" },
  { label: "Focus mode", icon: "expand-outline", href: "/focus" },
  { label: "Settings", icon: "settings-outline", href: "/settings" },
] as const;

export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title="More" />
      <View style={{ padding: 16, gap: 8 }}>
        {destinations.map((item) => (
          <Pressable
            key={item.href}
            accessibilityRole="link"
            onPress={() => router.push(item.href as Href)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              minHeight: 56,
              gap: 14,
              paddingHorizontal: 16,
              borderRadius: 10,
              backgroundColor: pressed ? theme.colors.pineSoft : theme.colors.surface,
            })}
          >
            <Ionicons name={item.icon} size={22} color={theme.colors.pine} />
            <Text style={{ flex: 1, color: theme.colors.ink, fontSize: 16, fontWeight: "500" }}>
              {item.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
