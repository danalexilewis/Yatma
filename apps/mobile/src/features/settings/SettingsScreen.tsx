import { useAuth, useUser } from "@clerk/expo";
import type { PingResult } from "@yatma/core";
import { useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { wipeLocalData } from "../../db/database";
import { shareEventsJsonl } from "../../export/jsonl";
import { useAppStore } from "../../state/atoms";
import { getSyncEngine } from "../../sync/engine";
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
  const { resetState } = useAppStore();

  async function onSignOut() {
    await wipeLocalData();
    resetState();
    if (isSignedIn) await signOut();
  }

  async function onDeleteAccount() {
    const engine = getSyncEngine();
    if (engine) {
      await engine.deleteAccount();
    }
    await wipeLocalData();
    resetState();
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
  const { resetState } = useAppStore();
  const [autoSend, setAutoSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

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
    await wipeLocalData();
    resetState();
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
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>0 / daily cap</Text>
      </Section>

      <Section title="Dictation">
        <View style={styles.switchRow}>
          <Text style={{ color: theme.colors.ink, fontSize: theme.type.row, flex: 1 }}>
            Auto-send after dictate
          </Text>
          <Switch
            value={autoSend}
            onValueChange={setAutoSend}
            trackColor={{ true: theme.colors.pine, false: theme.colors.line }}
          />
        </View>
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
