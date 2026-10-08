import "../src/polyfills";
import "../global.css";

import { RegistryProvider } from "@effect/atom-react";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/features/auth/AuthProvider";
import { requestCaptureOpen } from "../src/features/capture/captureIntent";
import { AppStateProvider } from "../src/state/atoms";
import { createTheme } from "../src/theme/theme";

function useDictateShortcut() {
  const router = useRouter();

  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url) return;
      const parsed = Linking.parse(url);
      const path = parsed.path ?? "";
      const host = parsed.hostname ?? "";
      if (path === "capture" || host === "capture" || url.includes("://capture")) {
        requestCaptureOpen();
        router.push("/(tabs)");
      }
    }

    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });
    return () => subscription.remove();
  }, [router]);
}

/** Root layout: Gesture Handler, SQLite-backed state, Clerk, navigation stack. */
export default function RootLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = createTheme(scheme);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <SafeAreaProvider>
        <RegistryProvider>
          <AppStateProvider>
            <AuthProvider>
              <StatusBar style={scheme === "dark" ? "light" : "dark"} />
              <DictateShortcutBridge />
              <Stack
                screenOptions={{
                  headerShown: false,
                  headerTintColor: theme.colors.pine,
                  headerTitleStyle: {
                    color: theme.colors.ink,
                    fontWeight: "600",
                  },
                  headerStyle: {
                    backgroundColor: theme.colors.canvas,
                  },
                  headerShadowVisible: false,
                  contentStyle: {
                    backgroundColor: theme.colors.canvas,
                  },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(auth)/sign-in" options={{ presentation: "modal" }} />
                <Stack.Screen
                  name="task/[id]"
                  options={{ presentation: "modal", headerShown: true, title: "Task" }}
                />
                <Stack.Screen name="page/[id]" options={{ headerShown: true, title: "Page" }} />
                <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: "Chat" }} />
                <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
                <Stack.Screen
                  name="project/[id]"
                  options={{ headerShown: true, title: "Project" }}
                />
              </Stack>
            </AuthProvider>
          </AppStateProvider>
        </RegistryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function DictateShortcutBridge() {
  useDictateShortcut();
  return null;
}
