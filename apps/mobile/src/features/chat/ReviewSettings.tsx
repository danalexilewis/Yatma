import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Switch, Text, TextInput, View } from "react-native";

import {
  beginGmail,
  disconnectGmail,
  gmailStatus,
  importGmail,
  readReviewSchedule,
  saveReviewSchedule,
} from "../../sync/reviewClient";
import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";

/** Optional server invitations and read-only Gmail intake share visible connection/error state. */
export function ReviewSettings() {
  const theme = useTheme();
  const store = useAppStore();
  const [enabled, setEnabled] = useState(false);
  const [localTime, setLocalTime] = useState("09:00");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    email: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    Promise.resolve()
      .then(() => Promise.all([readReviewSchedule(), gmailStatus()]))
      .then(([schedule, gmail]) => {
        if (generation.current !== current) return;
        setEnabled(schedule.enabled);
        setLocalTime(schedule.localTime);
        setTimezone(schedule.timezone);
        setStatus(gmail);
      })
      .catch((cause) => {
        if (generation.current === current)
          setError(cause instanceof Error ? cause.message : "Connect to load review settings.");
      });
    return () => {
      generation.current++;
    };
  }, [store.state.accountId]);
  async function run(action: (isCurrent: () => boolean) => Promise<string>) {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action(() => current === generation.current);
      if (current === generation.current) setNotice(message);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not complete this request.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function button(label: string, action: (isCurrent: () => boolean) => Promise<string>) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void run(action)}
        style={{
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 22,
          alignSelf: "flex-start",
        }}
      >
        <Text style={{ color: theme.colors.ink, opacity: busy ? 0.5 : 1 }}>{label}</Text>
      </Pressable>
    );
  }
  const inputStyle = {
    color: theme.colors.ink,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
    padding: 10,
  };
  return (
    <View style={{ padding: 16, backgroundColor: theme.colors.surface, borderRadius: 16, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: theme.colors.ink, fontSize: 20 }}>
        Review settings
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch
          accessibilityLabel="Enable morning review invitation"
          value={enabled}
          onValueChange={setEnabled}
          disabled={busy}
        />
        <Text style={{ color: theme.colors.ink }}>Morning review invitation</Text>
      </View>
      <Text style={{ color: theme.colors.muted }}>
        An invitation appears in Conversation. It adds no work to Today.
      </Text>
      <TextInput
        accessibilityLabel="Review time, 24 hour HH:MM"
        value={localTime}
        onChangeText={setLocalTime}
        editable={!busy}
        placeholder="09:00"
        style={inputStyle}
      />
      <TextInput
        accessibilityLabel="Review timezone"
        value={timezone}
        onChangeText={setTimezone}
        editable={!busy}
        autoCapitalize="none"
        style={inputStyle}
      />
      {button("Save review schedule", async () => {
        await saveReviewSchedule({ enabled, localTime, timezone });
        return "Review schedule saved.";
      })}
      <Text accessibilityRole="header" style={{ color: theme.colors.ink, fontSize: 18 }}>
        Gmail
      </Text>
      <Text style={{ color: theme.colors.muted }}>
        {status?.connected
          ? `Connected${status.email ? ` as ${status.email}` : ""}. Imported messages become review items.`
          : status?.email
            ? `Disconnect incomplete for ${status.email}. Retry disconnect to remove access.`
            : status?.configured === false
              ? "Gmail connection requires server configuration."
              : "Connect Gmail to review messages alongside your projects."}
      </Text>
      {!status?.connected && !status?.email && status?.configured !== false
        ? button("Connect Gmail", async (isCurrent) => {
            const result = await beginGmail();
            if (isCurrent()) await Linking.openURL(result.authorizationUrl);
            return "Complete the Gmail connection, then refresh its status here.";
          })
        : null}
      {button("Refresh Gmail status", async (isCurrent) => {
        const result = await gmailStatus();
        if (isCurrent()) setStatus(result);
        return "Connection status refreshed.";
      })}
      {status?.connected ? (
        <>
          {button(
            nextPage ? "Import more messages" : "Import Gmail messages",
            async (isCurrent) => {
              const result = await importGmail(nextPage ?? undefined);
              if (isCurrent()) setNextPage(result.nextPageToken);
              return `Received ${result.received} messages for review${result.nextPageToken ? ". More messages are available." : "."}`;
            },
          )}
        </>
      ) : null}
      {status?.email ? (
        <>
          {button("Disconnect Gmail", async (isCurrent) => {
            await disconnectGmail();
            if (isCurrent()) {
              setStatus((current) =>
                current ? { ...current, connected: false, email: null } : null,
              );
              setNextPage(null);
            }
            return "Gmail disconnected. Previously received items remain available.";
          })}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
