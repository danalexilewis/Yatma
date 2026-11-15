import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { useTheme } from "../../theme/theme";

export function SettingsSection(props: {
  readonly title: string;
  readonly description?: string;
  readonly badge?: string;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: theme.colors.ink, fontSize: 18, fontWeight: "600" }}
        >
          {props.title}
        </Text>
        {props.badge ? (
          <Text
            style={{
              color: theme.colors.pine,
              backgroundColor: theme.colors.pineSoft,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              fontSize: 11,
              fontWeight: "600",
            }}
          >
            {props.badge}
          </Text>
        ) : null}
      </View>
      {props.description ? (
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
          {props.description}
        </Text>
      ) : null}
      {props.children}
    </View>
  );
}

export function SettingsAction(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 10,
        alignSelf: "flex-start",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: props.primary ? theme.colors.pine : theme.colors.line,
        backgroundColor: props.primary ? theme.colors.pine : "transparent",
        opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text
        style={{
          color: props.primary
            ? theme.colors.onPine
            : props.danger
              ? theme.colors.danger
              : theme.colors.ink,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function SettingsToggle(props: {
  readonly label: string;
  readonly description?: string;
  readonly value: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.colors.ink, fontSize: 15 }}>{props.label}</Text>
        {props.description ? (
          <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19 }}>
            {props.description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={props.label}
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        trackColor={{ true: theme.colors.pine, false: theme.colors.line }}
      />
    </View>
  );
}

export function SettingsField(
  props: TextInputProps & { readonly label: string; readonly hint?: string },
) {
  const theme = useTheme();
  const { label, hint, ...input } = props;
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: theme.colors.ink, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={input.accessibilityLabel ?? label}
        placeholderTextColor={theme.colors.muted}
        style={[
          styles.input,
          {
            color: theme.colors.ink,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.canvas,
            opacity: input.editable === false ? 0.6 : 1,
          },
          input.style,
        ]}
      />
      {hint ? (
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 20, gap: 16 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});
