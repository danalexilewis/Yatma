import { Pressable, Text, View } from "react-native";

import { colors } from "../../theme/colors";

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

/** Live summary card rendered after an agent apply_changes turn. */
export function ChangeCard(props: ChangeCardProps) {
  const { summary, onUndo } = props;
  const parts = [
    summary.added > 0 ? `Added ${summary.added}` : null,
    summary.completed > 0 ? `completed ${summary.completed}` : null,
    summary.moved > 0 ? `moved ${summary.moved}` : null,
    summary.updated > 0 ? `updated ${summary.updated}` : null,
  ].filter(Boolean);

  return (
    <View className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
        {parts.length > 0 ? parts.join(", ") : "No changes"}
      </Text>
      {summary.rows.map((row, index) => (
        <Text
          key={`${row.label}-${index}`}
          className="mt-1 text-sm text-slate-600 dark:text-slate-300"
        >
          {row.label}
        </Text>
      ))}
      {onUndo ? (
        <Pressable
          onPress={onUndo}
          className="mt-3 self-start rounded-full px-3 py-1.5"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-sm font-medium text-white">Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
