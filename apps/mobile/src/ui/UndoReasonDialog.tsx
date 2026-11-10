import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../theme/theme";

type UndoReasonDialogProps = {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string) => void | Promise<void>;
};

/** Requires a deliberate explanation before an undo is committed. */
export function UndoReasonDialog(props: UndoReasonDialogProps) {
  const theme = useTheme();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = reason.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await props.onSubmit(value);
      setReason("");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (saving) return;
    setReason("");
    props.onCancel();
  }

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={{ color: theme.colors.ink, fontSize: 18, fontWeight: "700" }}>
            Why undo these changes?
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 8 }}>
            Reverted tasks will show this reason in their history.
          </Text>
          <TextInput
            accessibilityLabel="Reason for undo"
            autoFocus
            multiline
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. This wasn’t what I meant"
            placeholderTextColor={theme.colors.muted}
            editable={!saving}
            style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
          />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={cancel} disabled={saving} style={styles.button}>
              <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !reason.trim() || saving }}
              onPress={() => void submit()}
              disabled={!reason.trim() || saving}
              style={styles.button}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "700", opacity: !reason.trim() || saving ? 0.45 : 1 }}>
                Undo
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 16, padding: 20 },
  input: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginTop: 16, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 20, marginTop: 18 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
});
