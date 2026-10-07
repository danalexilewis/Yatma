import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme";

type Segment = {
  readonly key: string;
  readonly label: string;
};

type SegmentedControlProps = {
  readonly segments: readonly Segment[];
  readonly value: string;
  readonly onChange: (key: string) => void;
};

/** Compact top segment control for project sections. */
export function SegmentedControl(props: SegmentedControlProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.line,
          marginHorizontal: theme.space.screenX,
        },
      ]}
    >
      {props.segments.map((segment) => {
        const active = segment.key === props.value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => props.onChange(segment.key)}
            style={[
              styles.segment,
              {
                backgroundColor: active ? theme.colors.pine : "transparent",
                minHeight: 36,
              },
            ]}
          >
            <Text
              style={{
                color: active ? theme.colors.onPine : theme.colors.muted,
                fontSize: 13,
                fontWeight: active ? "600" : "500",
              }}
              numberOfLines={1}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: 4,
  },
});
