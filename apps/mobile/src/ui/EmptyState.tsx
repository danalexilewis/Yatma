import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme";

type EmptyStateProps = {
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

/** Centered empty invitation with an optional single action. */
export function EmptyState(props: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: theme.type.row,
          textAlign: "center",
          paddingHorizontal: theme.space.screenX,
        }}
      >
        {props.message}
      </Text>
      {props.actionLabel && props.onAction ? (
        <Pressable
          onPress={props.onAction}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: theme.colors.pine,
              opacity: pressed ? 0.85 : 1,
              minHeight: theme.touch,
            },
          ]}
        >
          <Text style={{ color: theme.colors.onPine, fontWeight: "600", fontSize: theme.type.row }}>
            {props.actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 16,
  },
  action: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
