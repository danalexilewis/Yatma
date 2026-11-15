import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import { useTheme } from "../../theme/theme";
import { getTriageCapacity, setTriageCapacity } from "../triage/triagePreferences";
import { getAutoSendDictation, setAutoSendDictation } from "./autoSendPreference";
import { SettingsAction, SettingsField, SettingsSection, SettingsToggle } from "./SettingsControls";

/** Device-local options use the current account's existing preference storage. */
export function AppPreferencesPanel() {
  const theme = useTheme();
  const [autoSend, setAutoSend] = useState(false);
  const [capacity, setCapacity] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    let current = true;
    setLoaded(false);
    setError(null);
    void Promise.all([getAutoSendDictation(), getTriageCapacity()])
      .then(([autoSend, capacity]) => {
        if (!current) return;
        setAutoSend(autoSend);
        setCapacity(String(capacity));
        setLoaded(true);
      })
      .catch(() => {
        if (current) setError("Could not load app preferences. Try loading them again.");
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [reload]);

  async function save(action: () => Promise<void>, message: string) {
    if (inFlight.current || !loaded) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (active.current) setNotice(message);
    } catch {
      if (active.current) setError("Could not save app preferences. Please try again.");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  function saveCapacity() {
    const value = Number(capacity);
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      setError("Enter a whole number between 1 and 1000 tasks per bucket.");
      setNotice(null);
      return;
    }
    void save(() => setTriageCapacity(value), "Triage capacity saved.");
  }

  return (
    <>
      <SettingsSection
        title="Voice & dictation"
        description="Preferences on this device, for the current account."
      >
        <SettingsToggle
          label="Auto-send after dictation"
          description="Send a completed transcript immediately. Turn off to review and edit it before sending."
          value={autoSend}
          disabled={!loaded || busy}
          onChange={(value) =>
            void save(async () => {
              await setAutoSendDictation(value);
              if (active.current) setAutoSend(value);
            }, "Dictation preference saved.")
          }
        />
      </SettingsSection>
      <SettingsSection
        title="Task triage"
        description="Limit the number of tasks in each classification bucket on this device."
      >
        <SettingsField
          label="Tasks per bucket"
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="number-pad"
          editable={loaded && !busy}
          hint="A whole number from 1 to 1000. Existing tasks are kept if you lower the limit."
        />
        <SettingsAction
          label={busy ? "Saving…" : "Save triage limit"}
          disabled={!loaded || busy}
          onPress={saveCapacity}
        />
      </SettingsSection>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      {!loaded && error ? (
        <SettingsAction label="Reload preferences" onPress={() => setReload(reload + 1)} />
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
          {notice}
        </Text>
      ) : null}
      <SettingsSection
        title="Appearance"
        badge="System"
        description="Yatma follows your device’s light or dark appearance."
      >
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
          Change your device appearance to update Yatma’s theme.
        </Text>
      </SettingsSection>
    </>
  );
}
