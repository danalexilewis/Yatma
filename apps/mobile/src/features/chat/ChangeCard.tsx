import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../theme/theme";

export type ChangeSummary = {
  readonly added: number;
  readonly completed: number;
  readonly moved: number;
  readonly updated: number;
  readonly rows: ReadonlyArray<{ readonly label: string }>;
};

type ChangeCardProps = {
  readonly summary: ChangeSummary;
  readonly onUndo?: () => void;
};

/** Flat inset summary after an agent apply_changes turn. */
export function ChangeCard(props: ChangeCardProps) {
  const { summary, onUndo } = props;
  const theme = useTheme();
  const parts = [
    summary.added > 0 ? `Added ${summary.added}` : null,
    summary.completed > 0 ? `completed ${summary.completed}` : null,
    summary.moved > 0 ? `moved ${summary.moved}` : null,
    summary.updated > 0 ? `updated ${summary.updated}` : null,
  ].filter(Boolean);

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.pineSoft,
          borderColor: theme.colors.line,
        },
      ]}
    >
      <View style={styles.row}>
        <Text
          style={{
            flex: 1,
            color: theme.colors.ink,
            fontSize: theme.type.meta,
            fontWeight: "600",
          }}
        >
          {parts.length > 0 ? parts.join(", ") : "No changes"}
        </Text>
        {onUndo ? (
          <Pressable onPress={onUndo} hitSlop={8} style={styles.undo}>
            <Text style={{ color: theme.colors.pine, fontWeight: "700", fontSize: theme.type.meta }}>
              Undo
            </Text>
          </Pressable>
        ) : null}
      </View>
      {summary.rows.map((row, index) => (
        <Text
          key={`${row.label}-${index}`}
          style={{
            marginTop: 4,
            color: theme.colors.muted,
            fontSize: theme.type.meta,
          }}
        >
          {row.label}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  undo: {
    minHeight: 32,
    justifyContent: "center",
  },
});
