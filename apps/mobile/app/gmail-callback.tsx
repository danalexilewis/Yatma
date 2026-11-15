import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { Screen, ScreenHeader } from "../src/ui";
import { completeGmail } from "../src/sync/reviewClient";

/** OAuth returns to the signed-in app; the Worker validates account-bound state. */
export default function GmailCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState("Ready to connect Gmail");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function finish() {
    if (!params.code || !params.state) {
      setStatus(
        params.error ? "Gmail permission was not granted." : "This connection link is incomplete.",
      );
      return;
    }
    setStatus("Connecting Gmail…");
    try {
      await completeGmail({ code: params.code, state: params.state });
      if (active.current) {
        setStatus("Gmail connected. Return to Conversation to import messages.");
        router.setParams({ code: undefined, state: undefined });
      }
    } catch {
      if (active.current)
        setStatus(
          "Could not connect. Check that you are signed in to the same Yatma account, then retry or start a new connection.",
        );
    }
  }
  return (
    <Screen>
      <ScreenHeader title="Connect Gmail" />
      <Text>{status}</Text>
      <Pressable accessibilityRole="button" onPress={finish}>
        <Text>Finish connecting</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/")}>
        <Text>Return to Conversation</Text>
      </Pressable>
    </Screen>
  );
}
