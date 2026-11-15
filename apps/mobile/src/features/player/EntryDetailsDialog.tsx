import type { DayEntry } from "@yatma/core";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { useStackPlayer } from "./PlayerProvider";
import { useTheme } from "../../theme/theme";

/** Activity and break details share one editor across Today and Focus. */
export function EntryDetailsDialog(props: {
  readonly entry: DayEntry;
  readonly onClose: () => void;
}) {
  const player = useStackPlayer();
  const theme = useTheme();
  const [title, setTitle] = useState(props.entry.title);
  const [minutes, setMinutes] = useState(String(props.entry.allocationMinutes));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const allocationMinutes = Number(minutes);
    if (
      !title.trim() ||
      !Number.isFinite(allocationMinutes) ||
      allocationMinutes <= 0 ||
      allocationMinutes > 1440
    ) {
      setError("Enter a title and a positive allocation up to 1440 minutes.");
      return;
    }
    if (
      await player.runtime.execute([
        {
          type: "day.update",
          entryId: props.entry.id,
          set: { title: title.trim(), allocationMinutes },
        },
      ])
    )
      props.onClose();
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          backgroundColor: theme.colors.overlay,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close entry details"
          onPress={props.onClose}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          role="dialog"
          aria-label="Entry details"
          style={{
            width: "100%",
            maxWidth: 440,
            borderRadius: 18,
            padding: 24,
            backgroundColor: theme.colors.surface,
            gap: 16,
          }}
        >
          <Text style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "600" }}>
            {props.entry.kind === "break" ? "Break" : "Activity"} details
          </Text>
          <TextInput
            autoFocus
            accessibilityLabel="Entry title"
            value={title}
            onChangeText={setTitle}
            style={{
              minHeight: 44,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.line,
              color: theme.colors.ink,
              fontSize: 17,
            }}
          />
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            Daily allocation in minutes
          </Text>
          <TextInput
            accessibilityLabel="Entry allocation in minutes"
            keyboardType="decimal-pad"
            value={minutes}
            onChangeText={setMinutes}
            style={{
              minHeight: 44,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.line,
              color: theme.colors.ink,
            }}
          />
          {error || player.runtimeState.error ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              {error ?? player.runtimeState.error}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 20 }}>
            <Pressable accessibilityRole="button" onPress={props.onClose} style={{ padding: 12 }}>
              <Text style={{ color: theme.colors.muted }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={player.runtimeState.pending}
              onPress={() => {
                void save();
              }}
              style={{ padding: 12 }}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
