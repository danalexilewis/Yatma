import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme/theme";

type ScreenProps = {
  readonly children: ReactNode;
  readonly edges?: ReadonlyArray<"top" | "bottom">;
  readonly scroll?: boolean;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly style?: StyleProp<ViewStyle>;
  /** Extra bottom padding so content clears a docked composer. */
  readonly composerClearance?: number;
};

/** Tab-root / full-screen shell with canvas fill and optional safe-area padding. */
export function Screen(props: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const edges = props.edges ?? ["top"];
  const paddingTop = edges.includes("top") ? insets.top : 0;
  const paddingBottom =
    (edges.includes("bottom") ? insets.bottom : 0) + (props.composerClearance ?? 0);

  const containerStyle = [
    styles.flex,
    {
      backgroundColor: theme.colors.canvas,
      paddingTop,
      paddingBottom,
    },
    props.style,
  ];

  if (props.scroll) {
    return (
      <View style={containerStyle}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, props.contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {props.children}
        </ScrollView>
      </View>
    );
  }

  return <View style={[containerStyle, props.contentStyle]}>{props.children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
});
