import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../../theme/theme";

export function MinutesField(props: {
  readonly label: string;
  readonly value: number;
  readonly disabled?: boolean;
  readonly onSave: (minutes: number) => Promise<unknown>;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(props.value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);
  async function save() {
    const minutes = Number(draft);
    if (!(minutes > 0 && minutes <= 1440)) {
      setError("Use a positive allocation up to 1440 minutes.");
      return;
    }
    setError(null);
    if (minutes !== props.value) await props.onSave(minutes);
  }
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      <View style={styles.backlogRow}>
        <Text style={{ flex: 1, color: theme.colors.muted, fontSize: theme.type.meta }}>
          {props.label}
        </Text>
        <TextInput
          accessibilityLabel={props.label}
          value={draft}
          onChangeText={setDraft}
          editable={!props.disabled}
          keyboardType="decimal-pad"
          onBlur={() => void save()}
          onSubmitEditing={() => void save()}
          style={[
            styles.input,
            {
              color: theme.colors.ink,
              borderColor: theme.colors.line,
              minWidth: 64,
              maxWidth: 110,
            },
          ]}
        />
        <Text style={{ color: theme.colors.muted }}>min</Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Action(props: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: props.disabled, selected: props.selected }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        styles.button,
        {
          backgroundColor: props.selected ? theme.colors.pineSoft : "transparent",
          opacity: props.disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.colors.pine, fontWeight: "600", fontSize: 13 }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backlogRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
  },
});
