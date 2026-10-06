import "../global.css";

import { RegistryProvider } from "@effect/atom-react";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/features/auth/AuthProvider";
import { AppStateProvider } from "../src/state/atoms";
import { requestCaptureOpen } from "../src/features/capture/captureIntent";

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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RegistryProvider>
          <AppStateProvider>
            <AuthProvider>
              <StatusBar style="auto" />
              <DictateShortcutBridge />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(auth)/sign-in" options={{ presentation: "modal" }} />
                <Stack.Screen
                  name="task/[id]"
                  options={{ presentation: "modal", headerShown: true, title: "Task" }}
                />
                <Stack.Screen name="page/[id]" options={{ headerShown: true, title: "Page" }} />
                <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: "Chat" }} />
                <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
                <Stack.Screen name="project/[id]" options={{ headerShown: true, title: "Project" }} />
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
