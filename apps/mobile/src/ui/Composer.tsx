import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme/theme";
import { IconButton } from "./IconButton";

type ComposerProps = {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder: string;
  readonly onSend: () => void;
  readonly onMic?: () => void;
  readonly busy?: boolean;
  readonly onStop?: () => void;
  /** Extra inset when docked above a tab bar (home indicator already in tab bar). */
  readonly tabBarPad?: boolean;
  readonly autoFocus?: boolean;
};

/** Docked pill composer: 16px input, mic always, send when nonempty. */
export function Composer(props: ComposerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);
  const canSend = props.value.trim().length > 0 && !props.busy;
  const bottomPad = props.tabBarPad ? 8 : Math.max(insets.bottom, 8);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        style={[
          styles.dock,
          {
            paddingBottom: bottomPad,
            paddingTop: 8,
            paddingHorizontal: theme.space.screenX,
            borderTopColor: theme.colors.line,
            backgroundColor: theme.colors.canvas,
          },
        ]}
      >
        <View
          style={[
            styles.pill,
            {
              backgroundColor: theme.colors.surface,
              borderColor: focused ? theme.colors.pine : theme.colors.line,
              minHeight: theme.touch,
            },
          ]}
        >
          {props.onMic ? (
            <IconButton
              name="mic-outline"
              accessibilityLabel="Dictate"
              color={theme.colors.pine}
              onPress={props.onMic}
              onLongPress={props.onMic}
            />
          ) : null}
          <TextInput
            value={props.value}
            onChangeText={props.onChangeText}
            placeholder={props.placeholder}
            placeholderTextColor={theme.colors.muted}
            multiline
            autoFocus={props.autoFocus}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.input,
              {
                color: theme.colors.ink,
                fontSize: theme.type.composer,
              },
            ]}
            returnKeyType="default"
          />
          {props.busy && props.onStop ? (
            <Pressable
              onPress={props.onStop}
              accessibilityLabel="Stop"
              style={[styles.send, { backgroundColor: theme.colors.muted }]}
            >
              <Text style={{ color: theme.colors.onPine, fontWeight: "700", fontSize: 13 }}>
                Stop
              </Text>
            </Pressable>
          ) : canSend ? (
            <Pressable
              onPress={props.onSend}
              accessibilityLabel="Send"
              style={[styles.send, { backgroundColor: theme.colors.pine }]}
            >
              <Text style={{ color: theme.colors.onPine, fontWeight: "700", fontSize: 15 }}>↑</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 4,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    lineHeight: 22,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
});
