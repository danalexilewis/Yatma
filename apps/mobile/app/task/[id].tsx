import { useEffect, useRef, type ComponentRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { TaskSheet } from "../../src/features/task/TaskSheet";
import { useTaskNavigation } from "../../src/features/task/useTaskNavigation";
import { useTheme } from "../../src/theme/theme";

/** Explicit transparent detail overlay on web and native; the originating route stays mounted. */
export default function TaskRoute() {
  const navigation = useTaskNavigation();
  const theme = useTheme();
  const closeButton = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS === "web") closeButton.current?.focus();
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") navigation.closeTask();
      if (event.key === "Tab") {
        const panel = document.querySelector('[role="dialog"][aria-label="Task details"]');
        const controls = panel
          ? Array.from(
              panel.querySelectorAll<HTMLElement>(
                'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
              ),
            ).filter(
              (element) =>
                !element.hasAttribute("disabled") &&
                element.getAttribute("aria-disabled") !== "true",
            )
          : [];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={navigation.closeTask}
        accessibilityLabel="Close task details"
        accessibilityRole="button"
      />
      <View
        accessibilityViewIsModal
        role="dialog"
        aria-label="Task details"
        style={[styles.panel, { backgroundColor: theme.colors.canvas }]}
      >
        <TaskSheet
          closeButton={
            <Pressable
              onPress={navigation.closeTask}
              accessibilityRole="button"
              accessibilityLabel="Close task details"
              style={styles.close}
              ref={closeButton}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>Close</Text>
            </Pressable>
          }
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Platform.OS === "web" ? 24 : 44,
    paddingHorizontal: Platform.OS === "web" ? 20 : 0,
    paddingBottom: Platform.OS === "web" ? 24 : 0,
  },
  panel: {
    width: "100%",
    maxWidth: 760,
    flex: 1,
    maxHeight: Platform.OS === "web" ? 860 : undefined,
    borderRadius: 20,
    overflow: "hidden",
  },
  close: { minHeight: 44, minWidth: 60, alignItems: "center", justifyContent: "center" },
});
