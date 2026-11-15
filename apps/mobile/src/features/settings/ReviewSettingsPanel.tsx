import { useEffect, useRef, useState } from "react";
import { Linking, Text } from "react-native";
import { ReviewSchedule } from "@yatma/contracts/review";
import * as Schema from "effect/Schema";

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
import { SettingsAction, SettingsField, SettingsSection, SettingsToggle } from "./SettingsControls";
import { useSyncStatus } from "../../state/syncStatusAtom";

/** Optional server invitations and read-only Gmail intake share visible connection/error state. */
export function ReviewSettingsPanel() {
  const theme = useTheme();
  const connection = useSyncStatus();
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
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoaded(false);
    setError(null);
    setNotice(null);
    setStatus(null);
    setNextPage(null);
    setBusy(false);
    Promise.resolve()
      .then(() => Promise.all([readReviewSchedule(), gmailStatus()]))
      .then(([schedule, gmail]) => {
        if (generation.current !== current) return;
        setEnabled(schedule.enabled);
        setLocalTime(schedule.localTime);
        setTimezone(schedule.timezone);
        setStatus(gmail);
        setLoaded(true);
      })
      .catch((cause) => {
        if (generation.current === current)
          setError(cause instanceof Error ? cause.message : "Connect to load review settings.");
      });
    return () => {
      generation.current++;
    };
  }, [store.state.accountId, connection, reload]);
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
      <SettingsAction label={label} disabled={busy || !loaded} onPress={() => void run(action)} />
    );
  }
  return (
    <>
      <SettingsSection
        title="Morning review"
        description="Choose when to receive a review invitation in Conversation."
      >
        <SettingsToggle
          label="Enable morning review invitation"
          description="An invitation appears in Conversation. It adds no work to Today."
          value={enabled}
          onChange={setEnabled}
          disabled={busy || !loaded}
        />
        <SettingsField
          label="Review time"
          accessibilityLabel="Review time, 24 hour HH:MM"
          hint="24-hour time, for example 09:00."
          value={localTime}
          onChangeText={setLocalTime}
          editable={loaded && !busy}
          placeholder="09:00"
        />
        <SettingsField
          label="Review timezone"
          hint="Use a timezone such as Pacific/Auckland or Europe/London."
          value={timezone}
          onChangeText={setTimezone}
          editable={loaded && !busy}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {button("Save review schedule", async () => {
          const input = { enabled, localTime: localTime.trim(), timezone: timezone.trim() };
          if (!Schema.is(ReviewSchedule)(input))
            throw new Error("Use a 24-hour time (HH:MM) and a valid timezone.");
          await saveReviewSchedule(input);
          return "Review schedule saved.";
        })}
      </SettingsSection>
      <SettingsSection
        title="Gmail"
        description="Read-only intake. Import messages to review alongside your projects."
      >
        <Text style={{ color: theme.colors.muted }}>
          {status?.connected
            ? `Connected${status.email ? ` as ${status.email}` : ""}. Imported messages become review items.`
            : status?.email
              ? `Disconnect incomplete for ${status.email}. Retry disconnect to remove access.`
              : status?.configured === false
                ? "Gmail connection requires server configuration."
                : !loaded
                  ? "Loading connection settings…"
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
      </SettingsSection>
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
      {!loaded && error ? (
        <SettingsAction
          label="Reload connection settings"
          disabled={busy}
          onPress={() => setReload(reload + 1)}
        />
      ) : null}
    </>
  );
}
