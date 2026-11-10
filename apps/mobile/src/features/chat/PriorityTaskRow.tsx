import { Ionicons } from "@expo/vector-icons";
import { localCalendarDate, type Task, type TaskUpdateInput } from "@yatma/core";
import { useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../theme/theme";

/** A tap opens details; a long press belongs exclusively to the list's drag gesture. */
export function PriorityTaskRow(props: {
  readonly task: Task;
  readonly projectTitle: string | undefined;
  readonly saving: boolean;
  readonly dragging: boolean;
  readonly onDrag: () => void;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onChange: (input: TaskUpdateInput) => Promise<void>;
  readonly onUp: () => void;
  readonly onDown: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const task = props.task;
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: props.dragging ? theme.colors.pineSoft : theme.colors.canvas },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Complete ${task.title}`}
        accessibilityState={{ checked: false, disabled: props.saving }}
        disabled={props.saving || props.dragging}
        onPress={() => void props.onChange({ taskId: task.id, status: "done" })}
        style={styles.control}
      >
        <View
          style={[
            styles.circle,
            { borderColor: theme.colors.muted, opacity: props.saving ? 0.4 : 1 },
          ]}
        />
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open task: ${task.title}`}
        accessibilityHint="Hold and drag to change priority"
        disabled={props.saving}
        delayLongPress={250}
        onLongPress={props.onDrag}
        onPress={() => router.push(`/task/${task.id}`)}
        style={styles.copy}
      >
        <Text
          selectable={false}
          style={{
            color: theme.colors.ink,
            fontSize: theme.type.row,
            fontWeight: "600",
            lineHeight: 24,
          }}
        >
          {task.title}
        </Text>
        {task.projectId || task.dueDate || task.status === "in_progress" ? (
          <Text
            selectable={false}
            style={{
              color:
                task.dueDate && task.dueDate < localCalendarDate(new Date())
                  ? theme.colors.danger
                  : theme.colors.muted,
              fontSize: theme.type.meta,
              marginTop: 3,
            }}
          >
            {[
              task.status === "in_progress" ? "In progress" : null,
              props.projectTitle,
              task.dueDate ? `Due ${task.dueDate}` : null,
            ]
              .filter(Boolean)
              .join("  ")}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        {...(Platform.OS === "web" ? { delayPressIn: 0 } : {})}
        onKeyDown={(event) => {
          if (props.saving) return;
          if (event.nativeEvent.key === "ArrowUp" && props.canMoveUp) {
            event.preventDefault();
            props.onUp();
          }
          if (event.nativeEvent.key === "ArrowDown" && props.canMoveDown) {
            event.preventDefault();
            props.onDown();
          }
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${task.title}`}
        accessibilityHint="Drag to change priority"
        accessibilityActions={[
          ...(props.canMoveUp ? [{ name: "increment" as const, label: "Move up" }] : []),
          ...(props.canMoveDown ? [{ name: "decrement" as const, label: "Move down" }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (props.saving) return;
          if (event.nativeEvent.actionName === "increment" && props.canMoveUp) props.onUp();
          if (event.nativeEvent.actionName === "decrement" && props.canMoveDown) props.onDown();
        }}
        disabled={props.saving}
        onPressIn={props.onDrag}
        style={styles.control}
      >
        <Ionicons name="reorder-two-outline" size={22} color={theme.colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", alignItems: "center", minHeight: 60 },
  control: { width: 44, minHeight: 48, alignItems: "center", justifyContent: "center" },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  copy: { flex: 1, minWidth: 0, paddingVertical: 8, minHeight: 44, justifyContent: "center" },
});
