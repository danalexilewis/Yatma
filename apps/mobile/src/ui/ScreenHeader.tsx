import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme";

type ScreenHeaderProps = {
  readonly title: string;
  readonly trailing?: ReactNode;
  readonly subtitle?: string;
};

/** Large left-aligned screen title with optional trailing actions. */
export function ScreenHeader(props: ScreenHeaderProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal: theme.space.screenX,
          paddingTop: 12,
          paddingBottom: 8,
        },
      ]}
    >
      <View style={styles.textCol}>
        <Text
          style={{
            color: theme.colors.ink,
            fontSize: theme.type.title,
            fontWeight: "700",
            letterSpacing: -0.3,
          }}
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
          >
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});
