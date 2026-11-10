import "../src/polyfills";
import "../global.css";

import { RegistryProvider } from "@effect/atom-react";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, type ReactNode } from "react";
import { Platform, Text, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/features/auth/AuthProvider";
import { requestCaptureOpen } from "../src/features/capture/captureIntent";
import { AppStateProvider, useAppStore } from "../src/state/atoms";
import { createTheme } from "../src/theme/theme";
import { EmptyState } from "../src/ui/EmptyState";

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
              <StorageGate>
                <DictateShortcutBridge />
                <StorageErrorNotice />
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
                    options={{ presentation: "card", headerShown: true, title: "Task" }}
                  />
                  <Stack.Screen name="page/[id]" options={{ headerShown: true, title: "Page" }} />
                  <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: "Chat" }} />
                  <Stack.Screen
                    name="project/[id]"
                    options={{ headerShown: true, title: "Project" }}
                  />
                </Stack>
              </StorageGate>
            </AuthProvider>
          </AppStateProvider>
        </RegistryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function StorageGate(props: { readonly children: ReactNode }) {
  const { state, switchLocalAccount } = useAppStore();

  if (!state.ready) {
    return (
      <View style={{ flex: 1 }} accessibilityRole={state.storageError ? "alert" : undefined}>
        <EmptyState
          message={state.storageError ?? "Opening your local workspace…"}
          actionLabel={
            state.storageError ? (Platform.OS === "web" ? "Reload" : "Retry") : undefined
          }
          onAction={() => {
            if (Platform.OS === "web") window.location.reload();
            else void switchLocalAccount(state.accountId).catch(() => {});
          }}
        />
      </View>
    );
  }

  return props.children;
}

function StorageErrorNotice() {
  const { state } = useAppStore();
  if (!state.storageError) return null;

  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: "#8B2F26", paddingHorizontal: 16, paddingVertical: 10 }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "600" }}>
        {state.storageError}
      </Text>
    </View>
  );
}

function DictateShortcutBridge() {
  useDictateShortcut();
  return null;
}
