import { Ionicons } from "@expo/vector-icons";
import { useRef, useState, type ComponentRef } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTheme } from "../theme/theme";

type Option = { label: string; selected?: boolean; onPress: () => void };
export type ChoiceMenuGroup = { title?: string; options: Option[] };

/** Anchored desktop menu; a bounded bottom sheet on narrow touch layouts. */
export function ChoiceMenu(props: {
  label: string;
  field?: boolean;
  groups: ChoiceMenuGroup[];
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const compact = width < 700;
  function close() {
    setAnchor(null);
  }
  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityState={{ expanded: anchor !== null, disabled: props.disabled }}
        disabled={props.disabled}
        onPress={() =>
          trigger.current?.measureInWindow((x, y, _w, h) => setAnchor({ x, y: y + h }))
        }
        style={({ hovered, pressed }) => [
          styles.button,
          props.field && {
            minHeight: 44,
            borderWidth: 1,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.surface,
          },
          {
            backgroundColor:
              hovered || pressed || props.active
                ? theme.colors.pineSoft
                : props.field
                  ? theme.colors.surface
                  : "transparent",
            opacity: props.disabled ? 0.4 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            color: props.active ? theme.colors.pine : theme.colors.ink,
            fontSize: 13,
            fontWeight: "500",
            maxWidth: props.field ? undefined : compact ? 92 : 180,
            flex: props.field ? 1 : undefined,
          }}
        >
          {props.label}
        </Text>
        <Ionicons name="chevron-down" size={12} color={theme.colors.muted} />
      </Pressable>
      <Modal visible={anchor !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: compact ? "#0005" : "transparent" }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.menu,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.line,
              maxHeight: compact ? height * 0.7 : Math.max(160, height - (anchor?.y ?? 0) - 24),
            },
            compact
              ? { left: 12, right: 12, bottom: 24 }
              : {
                  left: Math.max(12, Math.min(anchor?.x ?? 0, width - 292)),
                  top: (anchor?.y ?? 0) + 4,
                  width: 280,
                },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {props.groups.map((group, index) => (
              <View key={group.title ?? index} style={styles.group}>
                {group.title ? (
                  <Text style={[styles.groupTitle, { color: theme.colors.muted }]}>
                    {group.title}
                  </Text>
                ) : null}
                {group.options.map((option) => (
                  <Pressable
                    key={option.label}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: option.selected ?? false }}
                    onPress={() => {
                      option.onPress();
                      close();
                    }}
                    style={({ hovered, pressed }) => [
                      styles.option,
                      {
                        backgroundColor:
                          hovered || pressed || option.selected
                            ? theme.colors.pineSoft
                            : "transparent",
                      },
                    ]}
                  >
                    <Text style={{ flex: 1, color: theme.colors.ink, fontSize: 14 }}>
                      {option.label}
                    </Text>
                    {option.selected ? (
                      <Ionicons name="checkmark" size={16} color={theme.colors.pine} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  menu: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 6,
    boxShadow: "0 8px 32px #0003",
  },
  group: { paddingVertical: 4 },
  groupTitle: { fontSize: 11, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 },
  option: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
