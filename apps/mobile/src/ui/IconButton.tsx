import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme/theme";

type IconName = keyof typeof Ionicons.glyphMap;

type IconButtonProps = {
  readonly name: IconName;
  readonly onPress?: () => void;
  readonly onLongPress?: () => void;
  readonly accessibilityLabel: string;
  readonly color?: string;
  readonly size?: number;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
};

/** 44pt icon hit target used for header and composer actions. */
export function IconButton(props: IconButtonProps) {
  const theme = useTheme();
  const size = props.size ?? 22;
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.hit,
        {
          minWidth: theme.touch,
          minHeight: theme.touch,
          opacity: props.disabled ? 0.4 : pressed ? 0.65 : 1,
        },
        props.style,
      ]}
    >
      <Ionicons name={props.name} size={size} color={props.color ?? theme.colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: "center",
    justifyContent: "center",
  },
});
