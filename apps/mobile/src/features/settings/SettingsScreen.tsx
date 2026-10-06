import { useAuth, useUser } from "@clerk/expo";
import type { PingResult } from "@yatma/core";
import { useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { wipeLocalData } from "../../db/database";
import { shareEventsJsonl } from "../../export/jsonl";
import { useAppStore } from "../../state/atoms";
import { getSyncEngine } from "../../sync/engine";
import { colors } from "../../theme/colors";

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
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <Text className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Settings</Text>

      <Section title="Account">
        <Text className="text-base text-slate-800 dark:text-slate-100">
          {props.email ?? (props.signedIn ? "Signed in" : "Signed out")}
        </Text>
      </Section>

      <Section title="Usage today">
        <Text className="text-base text-slate-800 dark:text-slate-100">0 / daily cap</Text>
      </Section>

      <Section title="Dictation">
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-slate-800 dark:text-slate-100">Auto-send after dictate</Text>
          <Switch value={autoSend} onValueChange={setAutoSend} />
        </View>
      </Section>

      <Section title="Debug">
        <Pressable onPress={() => void onPing()} className="mb-2">
          <Text className="text-base font-medium text-slate-800 dark:text-slate-100">
            Ping sync server
          </Text>
        </Pressable>
        <Text className="text-sm text-slate-600 dark:text-slate-300">
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
        className="mb-3 rounded-2xl px-4 py-3"
        style={{ backgroundColor: colors.brand }}
      >
        <Text className="text-center font-medium text-white">
          {busy ? "Exporting…" : "Export JSONL"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => void onSignOut()}
        className="mb-3 rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-600"
      >
        <Text className="text-center font-medium text-slate-800 dark:text-slate-100">Sign out</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={onDeleteAccount}
        className="mb-8 rounded-2xl px-4 py-3"
        style={{ backgroundColor: colors.danger }}
      >
        <Text className="text-center font-medium text-white">Delete account</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <Text className="mb-2 text-xs uppercase text-slate-500">{props.title}</Text>
      {props.children}
    </View>
  );
}
