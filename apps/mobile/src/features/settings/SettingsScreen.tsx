import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import type { PingResult, UsageGetResult } from "@yatma/core";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { wipeLocalData } from "../../db/database";
import { shareEventsJsonl } from "../../export/jsonl";
import { useAppStore } from "../../state/atoms";
import { useSyncStatus } from "../../state/syncStatusAtom";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { Screen } from "../../ui";
import { useDesktopLayout } from "../../ui/useDesktopLayout";
import { AppPreferencesPanel } from "./AppPreferencesPanel";
import { ModelSettingsPanel } from "./ModelSettingsPanel";
import { PlanningSettingsPanel } from "./PlanningSettingsPanel";
import { ReviewSettingsPanel } from "./ReviewSettingsPanel";
import { SettingsAction, SettingsSection } from "./SettingsControls";

const sections = [
  { key: "ai", label: "AI", icon: "sparkles-outline" },
  { key: "planning", label: "Planning & focus", icon: "timer-outline" },
  { key: "connections", label: "Connections", icon: "link-outline" },
  { key: "app", label: "App & account", icon: "options-outline" },
] as const;

/** One home for account AI, synced planning defaults and device-local preferences. */
export function SettingsScreen() {
  const { state } = useAppStore();
  const key = `${state.accountId ?? "local"}:${state.ready}`;
  if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) {
    return <SettingsBody key={key} signedIn={false} email={null} />;
  }
  return <ClerkSettingsBody key={key} />;
}

function ClerkSettingsBody() {
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  async function onSignOut() {
    if (isSignedIn) await signOut();
  }
  async function onDeleteAccount() {
    const engine = getSyncEngine();
    if (!engine) throw new Error("Account deletion is unavailable while offline.");
    await engine.deleteAccount();
    await wipeLocalData();
    if (isSignedIn) await signOut();
  }
  return (
    <SettingsBody
      signedIn={Boolean(isSignedIn)}
      email={user?.primaryEmailAddress?.emailAddress ?? null}
      onSignOut={onSignOut}
      onDeleteAccount={onDeleteAccount}
    />
  );
}

function SettingsBody(props: {
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly onSignOut?: () => Promise<void>;
  readonly onDeleteAccount?: () => Promise<void>;
}) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const { state } = useAppStore();
  const connection = useSyncStatus();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState(params.section ?? "ai");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSection(params.section ?? "ai");
  }, [params.section]);
  const selected = sections.find((item) => item.key === section) ?? sections[0];
  const connected = Boolean(state.accountId) && connection === "connected";

  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError(null);
    try {
      await action();
      if (mounted.current) setConfirmDelete(false);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not complete this action. Please try again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <Screen>
      <View style={[styles.heading, { borderBottomColor: theme.colors.line }]}>
        <Text
          style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.5 }}
        >
          MAKE IT YOURS
        </Text>
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.7 }}
        >
          Settings
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21 }}>
          Your AI, your workflow, your preferences.
        </Text>
      </View>
      <View
        style={{
          flex: 1,
          flexDirection: desktop ? "row" : "column",
          width: "100%",
          maxWidth: 1100,
          alignSelf: "center",
        }}
      >
        <ScrollView
          accessibilityRole="tablist"
          horizontal={!desktop}
          showsHorizontalScrollIndicator={false}
          style={desktop ? { width: 220, flexGrow: 0 } : { flexGrow: 0 }}
          contentContainerStyle={{ padding: 16, gap: 6 }}
        >
          {sections.map((item) => {
            const active = selected.key === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setSection(item.key)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 44,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: active || pressed ? theme.colors.pineSoft : "transparent",
                })}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={active ? theme.colors.pine : theme.colors.muted}
                />
                <Text
                  style={{
                    color: active ? theme.colors.pine : theme.colors.muted,
                    fontWeight: active ? "600" : "500",
                    fontSize: 13,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView
          key={selected.key}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 48,
            gap: 16,
            width: "100%",
            maxWidth: 760,
            alignSelf: "center",
          }}
        >
          {selected.key === "ai" ? (
            <>
              <SettingsSection
                title="AI provider"
                badge="OpenRouter"
                description="Connect your own key and choose the model Yatma uses for chat."
              >
                <ModelSettingsPanel />
              </SettingsSection>
              <UsagePanel key={connection} />
            </>
          ) : null}
          {selected.key === "planning" ? (
            state.ready ? (
              <PlanningSettingsPanel />
            ) : (
              <Text style={{ color: theme.colors.muted }}>Loading planning preferences…</Text>
            )
          ) : null}
          {selected.key === "connections" ? (
            <>
              <ConnectionPanel key={connection} />
              {connected ? (
                <ReviewSettingsPanel />
              ) : (
                <SettingsSection
                  title="Review & Gmail"
                  description={
                    state.accountId
                      ? "Reconnect to configure morning reviews and Gmail intake."
                      : "Sign in and connect to configure morning reviews and Gmail intake."
                  }
                >
                  {!state.accountId ? (
                    <Link
                      href="/(auth)/sign-in"
                      style={{ color: theme.colors.pine, paddingVertical: 12 }}
                    >
                      Sign in to connect your account →
                    </Link>
                  ) : (
                    <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                      Your saved settings will be available when your connection returns.
                    </Text>
                  )}
                </SettingsSection>
              )}
            </>
          ) : null}
          {selected.key === "app" ? (
            <>
              {state.ready ? (
                <AppPreferencesPanel />
              ) : (
                <Text style={{ color: theme.colors.muted }}>Loading app preferences…</Text>
              )}
              <SettingsSection
                title="Account"
                description={props.email ?? (props.signedIn ? "Signed in" : "Using Yatma locally")}
              >
                {props.signedIn ? (
                  <SettingsAction
                    label={busy === "signout" ? "Signing out…" : "Sign out"}
                    disabled={busy !== null}
                    onPress={() => void run("signout", props.onSignOut!)}
                  />
                ) : (
                  <Link
                    href="/(auth)/sign-in"
                    style={{ color: theme.colors.pine, paddingVertical: 12 }}
                  >
                    Sign in to connect your devices →
                  </Link>
                )}
                <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                  Signing out keeps this account’s local data on this device.
                </Text>
              </SettingsSection>
              <SettingsSection
                title="Data & privacy"
                description="Export your event history, including tasks, projects and planning data. API keys are excluded."
              >
                <SettingsAction
                  label={busy === "export" ? "Exporting…" : "Export JSONL"}
                  disabled={!state.ready || busy !== null}
                  onPress={() => void run("export", shareEventsJsonl)}
                />
                {props.signedIn ? (
                  <SettingsAction
                    label="Delete account"
                    danger
                    disabled={!connected || busy !== null}
                    onPress={() => {
                      setError(null);
                      setConfirmDelete(true);
                    }}
                  />
                ) : null}
                {props.signedIn && !connected ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    Connect to delete your account.
                  </Text>
                ) : null}
              </SettingsSection>
              {error ? (
                <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                  {error}
                </Text>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>
      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setConfirmDelete(false);
        }}
      >
        <View
          style={{
            flex: 1,
            padding: 24,
            justifyContent: "center",
            backgroundColor: theme.colors.overlay,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              padding: 24,
              borderRadius: 16,
              gap: 16,
              backgroundColor: theme.colors.surface,
              width: "100%",
              maxWidth: 440,
              alignSelf: "center",
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "700" }}
            >
              Delete your account?
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
              This permanently deletes your remote account and its data, then removes this account’s
              local data. This cannot be undone.
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <SettingsAction
                label="Cancel"
                disabled={busy !== null}
                onPress={() => setConfirmDelete(false)}
              />
              <SettingsAction
                label={busy === "delete" ? "Deleting…" : "Permanently delete account"}
                danger
                disabled={busy !== null || !connected}
                onPress={() => void run("delete", props.onDeleteAccount!)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function UsagePanel() {
  const theme = useTheme();
  const { state } = useAppStore();
  const [usage, setUsage] = useState<UsageGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const engine = getSyncEngine();
    setUsage(null);
    setError(null);
    if (!engine || !state.accountId) return;
    setBusy(true);
    void engine.client
      .usageGet()
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch(() => {
        if (active) setError("Could not load usage. Try refreshing.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [state.accountId, reload]);
  return (
    <SettingsSection
      title="Usage today"
      description="Your daily token allowance in Yatma. Provider charges are managed in your OpenRouter account."
    >
      <Text style={{ color: theme.colors.ink, fontSize: 22, fontWeight: "600" }}>
        {usage
          ? `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens`
          : busy
            ? "Loading usage…"
            : (error ?? "Connect to your account to load usage.")}
      </Text>
      {usage ? (
        <>
          <View
            style={{
              height: 6,
              backgroundColor: theme.colors.line,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                backgroundColor: theme.colors.pine,
                width: `${Math.min(100, Math.max(0, (usage.used / Math.max(1, usage.limit)) * 100))}%`,
              }}
            />
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            Resets {new Date(usage.resetsAt).toLocaleString()}
          </Text>
        </>
      ) : null}
      <SettingsAction
        label={busy ? "Refreshing…" : "Refresh usage"}
        disabled={busy || !state.accountId}
        onPress={() => setReload(reload + 1)}
      />
    </SettingsSection>
  );
}

function ConnectionPanel() {
  const theme = useTheme();
  const connection = useSyncStatus();
  const [result, setResult] = useState<PingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function ping() {
    const engine = getSyncEngine();
    if (!engine || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await engine.ping();
      if (mounted.current) setResult(value);
    } catch {
      if (mounted.current)
        setError("Could not reach the sync server. Check your connection and try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <SettingsSection
      title="Sync & connection"
      badge={connection === "connected" ? "Connected" : "Offline"}
      description="Your signed-in account connects your tasks and preferences across devices."
    >
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
        {connection === "upgrade_required"
          ? "Update Yatma to resume syncing."
          : connection === "connecting"
            ? "Connecting to your account…"
            : connection === "error"
              ? "Connection interrupted. Local task changes remain available."
              : connection === "connected"
                ? "Connected to your account over an encrypted connection."
                : "Local changes stay on this device until you sign in and connect."}
      </Text>
      <SettingsAction
        label={busy ? "Checking…" : "Check connection"}
        disabled={busy || connection !== "connected"}
        onPress={() => void ping()}
      />
      {result ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
          {result.ok ? "Server responded" : "Server reported a problem"} ·{" "}
          {new Date(result.now).toLocaleString()}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  heading: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
