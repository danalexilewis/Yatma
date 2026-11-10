import { useAuth, useUser } from "@clerk/expo";
import type { PingResult, UsageGetResult } from "@yatma/core";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { wipeLocalData } from "../../db/database";
import { shareEventsJsonl } from "../../export/jsonl";
import { getSyncEngine } from "../../sync/engine";
import { getAutoSendDictation, setAutoSendDictation } from "./autoSendPreference";
import { DEFAULT_TRIAGE_CAPACITY, getTriageCapacity, setTriageCapacity } from "../triage/triagePreferences";
import { useTheme } from "../../theme/theme";
import { Screen } from "../../ui";

function isClerkConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

/** Account, usage, export, delete account, sign out. */
export function SettingsScreen() {
  if (!isClerkConfigured()) {
    return (
      <SettingsBody
        signedIn={false}
        email={null}
        onSignOut={async () => {}}
        onDeleteAccount={async () => {}}
      />
    );
  }
  return <ClerkSettingsBody />;
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
  readonly onSignOut: () => Promise<void>;
  readonly onDeleteAccount: () => Promise<void>;
}) {
  const theme = useTheme();
  const [autoSend, setAutoSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageGetResult | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [triageCapacity, setTriageCapacityValue] = useState(String(DEFAULT_TRIAGE_CAPACITY));

  useEffect(() => {
    let active = true;
    void getAutoSendDictation().then(setting => {
      if (active) setAutoSend(setting);
    }).catch(error => {
      Alert.alert("Settings unavailable", error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getTriageCapacity().then((capacity) => {
      if (active) setTriageCapacityValue(String(capacity));
    });
    return () => { active = false; };
  }, []);

  async function onSaveTriageCapacity() {
    const value = Number(triageCapacity);
    try {
      await setTriageCapacity(value);
      setTriageCapacityValue(String(value));
    } catch (error) {
      Alert.alert("Could not save capacity", error instanceof Error ? error.message : String(error));
    }
  }

  async function onAutoSendChange(enabled: boolean) {
    setAutoSend(enabled);
    try {
      await setAutoSendDictation(enabled);
    } catch (error) {
      setAutoSend(!enabled);
      Alert.alert("Could not save setting", error instanceof Error ? error.message : String(error));
    }
  }

  async function onRefreshUsage() {
    setUsageError(null);
    const engine = getSyncEngine();
    if (!engine) {
      setUsage(null);
      setUsageError("Connect to your account to load usage.");
      return;
    }
    try {
      setUsage(await engine.client.usageGet());
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "Usage could not be loaded.");
    }
  }

  useEffect(() => {
    void onRefreshUsage();
  }, []);

  async function onExport() {
    setBusy(true);
    try {
      await shareEventsJsonl();
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await props.onSignOut();
  }

  async function onPing() {
    setPingError(null);
    const engine = getSyncEngine();
    if (!engine) {
      setPingError("sync engine not running");
      setPingResult(null);
      return;
    }
    try {
      const result = await engine.ping();
      setPingResult(result);
    } catch (error) {
      setPingResult(null);
      setPingError(error instanceof Error ? error.message : "ping failed");
    }
  }

  function onDeleteAccount() {
    Alert.alert(
      "Delete account",
      "This will wipe local data and request remote deletion.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await props.onDeleteAccount();
              } catch (error) {
                Alert.alert(
                  "Delete failed",
                  error instanceof Error ? error.message : "Unknown error",
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <Screen
      edges={[]}
      scroll
      contentStyle={{ paddingHorizontal: theme.space.screenX, paddingTop: 12, paddingBottom: 40 }}
    >
      <Section title="Account">
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>
          {props.email ?? (props.signedIn ? "Signed in" : "Signed out")}
        </Text>
      </Section>

      <Section title="Usage today">
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>
          {usage
            ? `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens`
            : usageError ?? "Loading usage…"}
        </Text>
        {usage ? (
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 4 }}>
            Resets {new Date(usage.resetsAt).toLocaleString()}
          </Text>
        ) : null}
        <Pressable onPress={() => void onRefreshUsage()} style={{ minHeight: 36, justifyContent: "center" }}>
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta, fontWeight: "600" }}>
            Refresh usage
          </Text>
        </Pressable>
      </Section>

      <Section title="Dictation">
        <View style={styles.switchRow}>
          <Text style={{ color: theme.colors.ink, fontSize: theme.type.row, flex: 1 }}>
            Auto-send after dictate
          </Text>
          <Switch
            value={autoSend}
            onValueChange={(value) => void onAutoSendChange(value)}
            trackColor={{ true: theme.colors.pine, false: theme.colors.line }}
          />
        </View>
      </Section>

      <Section title="Task triage">
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>
          Maximum tasks in each bucket
        </Text>
        <TextInput
          accessibilityLabel="Maximum tasks per triage bucket"
          value={triageCapacity}
          onChangeText={setTriageCapacityValue}
          onBlur={() => void onSaveTriageCapacity()}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={() => void onSaveTriageCapacity()}
          style={{ color: theme.colors.ink, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, width: 100 }}
        />
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 6 }}>
          Choose a limit from 1 to 1000. Full buckets cannot accept more tasks.
        </Text>
      </Section>

      <Section title="Debug">
        <Pressable onPress={() => void onPing()} style={{ minHeight: 36, justifyContent: "center" }}>
          <Text style={{ color: theme.colors.ink, fontSize: theme.type.row, fontWeight: "500" }}>
            Ping sync server
          </Text>
        </Pressable>
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 4 }}>
          {pingError
            ? `error: ${pingError}`
            : pingResult
              ? `ok=${String(pingResult.ok)} now=${pingResult.now}`
              : "not pinged"}
        </Text>
      </Section>

      <Pressable
        disabled={busy}
        onPress={() => void onExport()}
        style={[styles.button, { backgroundColor: theme.colors.pine, opacity: busy ? 0.6 : 1 }]}
      >
        <Text style={{ color: theme.colors.onPine, fontWeight: "600", textAlign: "center" }}>
          {busy ? "Exporting…" : "Export JSONL"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => void onSignOut()}
        style={[
          styles.button,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.line,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Text style={{ color: theme.colors.ink, fontWeight: "600", textAlign: "center" }}>
          Sign out
        </Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={onDeleteAccount}
        style={[styles.button, { backgroundColor: theme.colors.danger, opacity: busy ? 0.6 : 1 }]}
      >
        <Text style={{ color: "#fff", fontWeight: "600", textAlign: "center" }}>
          Delete account
        </Text>
      </Pressable>
    </Screen>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.line,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: theme.type.meta,
          fontWeight: "600",
          marginBottom: 8,
        }}
      >
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  button: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    minHeight: 48,
    justifyContent: "center",
  },
});
