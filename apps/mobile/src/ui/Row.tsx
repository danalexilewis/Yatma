import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme/theme";

type RowProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly tickColor?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly last?: boolean;
};

/** Full-bleed list row with optional quadrant tick. */
export function Row(props: RowProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.touch,
          paddingHorizontal: theme.space.screenX,
          paddingVertical: theme.space.rowY,
          backgroundColor: pressed && props.onPress ? theme.colors.pineSoft : "transparent",
          borderBottomColor: theme.colors.line,
          borderBottomWidth: props.last ? 0 : StyleSheet.hairlineWidth,
        },
        props.style,
      ]}
    >
      {props.tickColor ? (
        <View style={[styles.tick, { backgroundColor: props.tickColor }]} />
      ) : null}
      {props.leading ? <View style={styles.leading}>{props.leading}</View> : null}
      <View style={styles.body}>
        <Text
          style={{
            color: theme.colors.ink,
            fontSize: theme.type.row,
            fontWeight: "500",
          }}
          numberOfLines={2}
        >
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.type.meta,
              marginTop: 2,
            }}
            numberOfLines={2}
          >
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  tick: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    marginRight: 12,
  },
  leading: {
    marginRight: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    marginLeft: 12,
  },
});
