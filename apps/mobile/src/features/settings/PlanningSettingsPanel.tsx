import { ADMIN_TEMPLATE, type StackPreferencesUpdatedFields } from "@yatma/core";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";

import { requestPlayerReminders } from "../../application/reminders";
import { useTheme } from "../../theme/theme";
import { ChoiceMenu } from "../../ui/ChoiceMenu";
import { useStackPlayer } from "../player/PlayerProvider";
import { SceneControls } from "../player/Scenes";
import { SettingsAction, SettingsField, SettingsSection, SettingsToggle } from "./SettingsControls";

/** Writes the same synced defaults consumed by daily assembly and the focus player. */
export function PlanningSettingsPanel() {
  const player = useStackPlayer();
  const theme = useTheme();
  const preferences = player.preferences;
  const [defaultMinutes, setDefaultMinutes] = useState(
    String(preferences.defaultAllocationMinutes),
  );
  const [workMinutes, setWorkMinutes] = useState(String(preferences.workIntervalMinutes));
  const [breakMinutes, setBreakMinutes] = useState(String(preferences.breakMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    setDefaultMinutes(String(preferences.defaultAllocationMinutes));
    setWorkMinutes(String(preferences.workIntervalMinutes));
    setBreakMinutes(String(preferences.breakMinutes));
  }, [
    preferences.defaultAllocationMinutes,
    preferences.workIntervalMinutes,
    preferences.breakMinutes,
  ]);
  const templates = [
    ADMIN_TEMPLATE,
    ...[...player.state.folded.stackTemplates.values()].filter(
      (template) => template.id !== "admin" && !template.archived,
    ),
  ];
  const disabled = busy || !player.state.ready;

  async function update(set: StackPreferencesUpdatedFields) {
    if (inFlight.current || !player.state.ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await player.daily.preferences(set);
      setNotice("Planning defaults saved.");
    } catch {
      setError("Could not save planning defaults. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function saveAllocations() {
    const values = [defaultMinutes, workMinutes, breakMinutes].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 1440)) {
      setError("Use a duration greater than 0 and up to 1440 minutes for each field.");
      setNotice(null);
      return;
    }
    void update({
      defaultAllocationMinutes: values[0],
      workIntervalMinutes: values[1],
      breakMinutes: values[2],
    });
  }

  async function enableReminders() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (await requestPlayerReminders()) {
        await player.runtime.reconcile();
        setNotice("Time reminders are permitted on this device.");
      } else
        setError("Reminder permission was not granted. You can change it in your device settings.");
    } catch {
      setError("Could not enable time reminders. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsSection
        title="Daily planning"
        description="Defaults sync with your account. Opening routines apply to future days; existing daily edits are preserved."
      >
        <Text style={{ color: theme.colors.ink, fontSize: 13, fontWeight: "600" }}>
          Opening routine
        </Text>
        <ChoiceMenu
          field
          label={
            templates.find((template) => template.id === preferences.openingTemplateId)?.title ??
            "No routine"
          }
          accessibilityLabel="Opening routine"
          disabled={disabled}
          groups={[
            {
              options: [
                {
                  label: "No routine",
                  selected: preferences.openingTemplateId === null,
                  onPress: () => void update({ openingTemplateId: null }),
                },
                ...templates.map((template) => ({
                  label: template.title,
                  selected: preferences.openingTemplateId === template.id,
                  onPress: () => void update({ openingTemplateId: template.id }),
                })),
              ],
            },
          ]}
        />
        <Link
          href="/routines"
          style={{ color: theme.colors.pine, fontSize: 13, paddingVertical: 12 }}
        >
          Create and manage routines →
        </Link>
        <SettingsToggle
          label="Automatic breaks"
          description="Add breaks as work accumulates. Manual changes to breaks take precedence."
          value={preferences.automaticBreaks}
          disabled={disabled}
          onChange={(automaticBreaks) => void update({ automaticBreaks })}
        />
        <SettingsField
          label="Default task allocation (minutes)"
          value={defaultMinutes}
          onChangeText={setDefaultMinutes}
          keyboardType="decimal-pad"
          editable={!disabled}
        />
        <SettingsField
          label="Work minutes between breaks"
          value={workMinutes}
          onChangeText={setWorkMinutes}
          keyboardType="decimal-pad"
          editable={!disabled}
        />
        <SettingsField
          label="Break duration (minutes)"
          value={breakMinutes}
          onChangeText={setBreakMinutes}
          keyboardType="decimal-pad"
          editable={!disabled}
        />
        <SettingsAction
          label={busy ? "Saving…" : "Save durations"}
          primary
          disabled={disabled}
          onPress={saveAllocations}
        />
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
      </SettingsSection>
      <SettingsSection
        title="Time reminders"
        description="A check-in when your planned time elapses. Reminders never complete tasks or advance your stack."
      >
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
          {Platform.OS === "web"
            ? "Time reminders are available in the native app. The browser player continues to keep time."
            : player.runtimeState.reminder === "scheduled"
              ? "A reminder is scheduled for the current allocation."
              : "Enable notifications here. Manage notification permissions in your device settings."}
        </Text>
        {Platform.OS !== "web" ? (
          <SettingsAction
            label="Enable time reminders"
            disabled={disabled}
            onPress={() => void enableReminders()}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Focus & sound"
        description="Your soundscape, volume and mute preferences apply to the focus player."
      >
        <View style={{ margin: -16 }}>
          <SceneControls />
        </View>
      </SettingsSection>
    </>
  );
}
