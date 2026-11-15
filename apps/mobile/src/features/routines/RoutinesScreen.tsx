import { ADMIN_TEMPLATE, type StackTemplate } from "@yatma/core";
import { randomUUID } from "expo-crypto";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useStackPlayer } from "../player/PlayerProvider";
import { Action } from "../today/TodayControls";
import { useTheme } from "../../theme/theme";
import { Screen, ScreenHeader } from "../../ui";

export function RoutinesScreen() {
  const player = useStackPlayer();
  const theme = useTheme();
  const { state, entries, runtime, runtimeState, dayId } = player;
  const [routineTitle, setRoutineTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (state.ready)
      void player.daily.ensureToday(player.date, player.timezone, false).catch((cause: unknown) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [state.ready, player.daily, player.date, player.timezone]);
  const templates = [
    ADMIN_TEMPLATE,
    ...[...state.folded.stackTemplates.values()].filter(
      (template) => template.id !== "admin" && !template.archived,
    ),
  ];
  async function saveRoutine() {
    if (!routineTitle.trim() || entries.length === 0) {
      setError("Name the routine and add at least one item.");
      return;
    }
    const existing = templates.find(
      (template) => template.title === routineTitle.trim() && template.id !== "admin",
    );
    const template: StackTemplate = {
      id: existing?.id ?? `routine:${randomUUID()}`,
      version: (existing?.version ?? 0) + 1,
      title: routineTitle.trim(),
      updatedAt: player.now,
      items: entries
        .filter((entry) => !entry.origin.startsWith("auto-break:"))
        .map((entry, index) => ({
          key: existing?.items[index]?.key ?? `item-${index}`,
          kind: entry.kind,
          title: entry.title,
          allocationMinutes: entry.allocationMinutes,
          taskId: entry.taskId,
          preparation: entry.preparation,
        })),
    };
    if (await runtime.execute([{ type: "template.save", template }])) setRoutineTitle("");
  }
  return (
    <Screen>
      <ScreenHeader title="Routines" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}
      >
        {error || runtimeState.error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {error ?? runtimeState.error}
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.heading, { color: theme.colors.ink }]}>Opening routine</Text>
          <Text style={{ color: theme.colors.muted }}>
            Choose your default opening routine, breaks and allocations in Settings.
          </Text>
          <Link
            href="/settings?section=planning"
            style={{ color: theme.colors.pine, paddingVertical: 12 }}
          >
            Planning &amp; focus settings →
          </Link>
          {player.preferences.openingTemplateId ? (
            <Action
              label="Append selected routine"
              onPress={() => {
                void runtime.execute([
                  {
                    type: "day.assemble",
                    includeBacklog: false,
                    dayId,
                    templateId: player.preferences.openingTemplateId,
                    append: true,
                  },
                ]);
              }}
            />
          ) : null}
          <Text style={[styles.heading, { color: theme.colors.ink }]}>
            Save this stack as a routine
          </Text>
          <TextInput
            accessibilityLabel="Routine name"
            value={routineTitle}
            onChangeText={setRoutineTitle}
            placeholder="Routine name"
            placeholderTextColor={theme.colors.muted}
            style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
          />
          <Action
            label="Save routine"
            onPress={() => void saveRoutine()}
            disabled={runtimeState.pending}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  column: { width: "100%", maxWidth: 760, alignSelf: "center" },
  heading: { fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 8 },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  section: { gap: 8, paddingVertical: 12 },
  backlogRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
  },
});
