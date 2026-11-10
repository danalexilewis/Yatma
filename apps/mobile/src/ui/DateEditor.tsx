import { addCalendarDays, isCalendarDate, localCalendarDate } from "@yatma/core";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../theme/theme";

/** Calendar-only date editing with explicit save, quick choices, and visible persistence failures. */
export function DateEditor(props: {
  readonly value: string | null;
  readonly onSave: (value: string | null) => Promise<unknown>;
  readonly label?: string;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(props.value ?? "");
  const [source, setSource] = useState(props.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (source !== props.value) {
    setSource(props.value);
    setDraft(props.value ?? "");
  }
  const label = props.label ?? "Due date";
  const today = localCalendarDate(new Date());

  async function save(value: string | null) {
    if (saving) return;
    const next = value?.trim() || null;
    if (next !== null && !isCalendarDate(next)) {
      setError("Enter a valid date as YYYY-MM-DD.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await props.onSave(next);
      setDraft(next ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the date. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.editor}>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={label}
          value={draft}
          onChangeText={setDraft}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.muted}
          maxLength={10}
          editable={!saving}
          autoCapitalize="none"
          style={[
            styles.input,
            {
              color: theme.colors.ink,
              borderColor: theme.colors.line,
              backgroundColor: theme.colors.surface,
            },
          ]}
          onSubmitEditing={() => void save(draft)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save ${label.toLowerCase()}`}
          disabled={saving}
          onPress={() => void save(draft)}
          style={styles.save}
        >
          <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>
            {saving ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.quick}>
        {[
          { title: "Today", value: today },
          { title: "Tomorrow", value: addCalendarDays(today, 1) },
          { title: "Next week", value: addCalendarDays(today, 7) },
          { title: "Clear", value: null },
        ].map((choice) => (
          <Pressable
            key={choice.title}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${choice.title}`}
            disabled={saving}
            onPress={() => void save(choice.value)}
            style={[styles.choice, { backgroundColor: theme.colors.pineSoft }]}
          >
            <Text style={{ color: theme.colors.pine, fontSize: 12 }}>{choice.title}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 8 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  save: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center" },
  quick: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  choice: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 8 },
});
