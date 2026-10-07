import type { Quadrant, Task } from "@yatma/core";
import { TaskId as TaskIdSchema } from "@yatma/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectInboxTasks, selectQuadrantTasks } from "../../state/selectors";
import { useTheme, type Theme } from "../../theme/theme";
import { EmptyState, Row, Screen, ScreenHeader } from "../../ui";

const QUADRANTS: ReadonlyArray<{
  readonly key: Quadrant;
  readonly label: string;
}> = [
  { key: "do", label: "Do" },
  { key: "schedule", label: "Schedule" },
  { key: "delegate", label: "Delegate" },
  { key: "eliminate", label: "Eliminate" },
];

const SWIPE_THRESHOLD = 64;

/** Throw-card triage with edge labels and quadrant counts. */
export function TriageScreen() {
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const { updateTask } = useAppStore();
  const inbox = selectInboxTasks(folded);
  const topInbox = inbox[0];
  const [focused, setFocused] = useState<Quadrant | null>(null);

  async function triage(task: Task, quadrant: Quadrant) {
    await updateTask({ taskId: TaskIdSchema.make(task.id), quadrant });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const focusedTasks = focused ? selectQuadrantTasks(folded, focused) : [];

  return (
    <Screen>
      <ScreenHeader
        title="Triage"
        subtitle={inbox.length > 0 ? `${inbox.length} in inbox` : "Inbox clear"}
      />

      <View style={styles.throwArea}>
        {topInbox ? (
          <InboxSwipeCard
            task={topInbox}
            theme={theme}
            onOpen={() => router.push(`/task/${topInbox.id}`)}
            onTriage={(quadrant) => void triage(topInbox, quadrant)}
          />
        ) : (
          <EmptyState message="Inbox is clear. Capture something new from Now." />
        )}
      </View>

      <View
        style={[
          styles.counts,
          {
            borderTopColor: theme.colors.line,
            paddingHorizontal: theme.space.screenX,
          },
        ]}
      >
        {QUADRANTS.map((quadrant) => {
          const count = selectQuadrantTasks(folded, quadrant.key).length;
          const active = focused === quadrant.key;
          const color =
            quadrant.key === "do"
              ? theme.colors.do
              : quadrant.key === "schedule"
                ? theme.colors.schedule
                : quadrant.key === "delegate"
                  ? theme.colors.delegate
                  : theme.colors.eliminate;
          return (
            <Pressable
              key={quadrant.key}
              onPress={() => setFocused((current) => (current === quadrant.key ? null : quadrant.key))}
              style={[
                styles.countCell,
                {
                  backgroundColor: active ? `${color}18` : "transparent",
                  borderColor: theme.colors.line,
                },
              ]}
            >
              <Text style={{ color, fontWeight: "700", fontSize: 20 }}>{count}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 2 }}>
                {quadrant.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {focused ? (
        <ScrollView style={styles.focusedList}>
          {focusedTasks.length === 0 ? (
            <Text
              style={{
                color: theme.colors.muted,
                textAlign: "center",
                padding: 24,
                fontSize: theme.type.meta,
              }}
            >
              No tasks in {focused}.
            </Text>
          ) : (
            focusedTasks.map((task, index) => (
              <Row
                key={task.id}
                title={task.title}
                subtitle={task.status.replace("_", " ")}
                last={index === focusedTasks.length - 1}
                onPress={() => router.push(`/task/${task.id}`)}
              />
            ))
          )}
        </ScrollView>
      ) : null}
    </Screen>
  );
}

function InboxSwipeCard(props: {
  readonly task: Task;
  readonly theme: Theme;
  readonly onOpen: () => void;
  readonly onTriage: (quadrant: Quadrant) => void;
}) {
  const { theme } = props;
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  function settle(quadrant: Quadrant | null) {
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    if (quadrant) props.onTriage(quadrant);
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .activeOffsetY([-12, 12])
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      const ax = Math.abs(event.translationX);
      const ay = Math.abs(event.translationY);
      if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) {
        runOnJS(settle)(null);
        return;
      }
      if (ay >= ax) {
        runOnJS(settle)(event.translationY < 0 ? "do" : "eliminate");
        return;
      }
      runOnJS(settle)(event.translationX > 0 ? "schedule" : "delegate");
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  const scheduleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0.35, 1], "clamp"),
  }));
  const doStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateY.value, [0, SWIPE_THRESHOLD], [0.35, 1], "clamp"),
  }));
  const delegateStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [0, SWIPE_THRESHOLD], [0.35, 1], "clamp"),
  }));
  const eliminateStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, SWIPE_THRESHOLD], [0.35, 1], "clamp"),
  }));

  return (
    <View style={styles.cardStage}>
      <Animated.Text
        style={[
          styles.edgeLabel,
          styles.edgeTop,
          { color: theme.colors.do },
          doStyle,
        ]}
      >
        Do
      </Animated.Text>
      <Animated.Text
        style={[
          styles.edgeLabel,
          styles.edgeRight,
          { color: theme.colors.schedule },
          scheduleStyle,
        ]}
      >
        Schedule
      </Animated.Text>
      <Animated.Text
        style={[
          styles.edgeLabel,
          styles.edgeLeft,
          { color: theme.colors.delegate },
          delegateStyle,
        ]}
      >
        Delegate
      </Animated.Text>
      <Animated.Text
        style={[
          styles.edgeLabel,
          styles.edgeBottom,
          { color: theme.colors.eliminate },
          eliminateStyle,
        ]}
      >
        Eliminate
      </Animated.Text>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            cardStyle,
            styles.throwCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.line,
            },
          ]}
        >
          <Pressable onPress={props.onOpen} style={styles.throwPress}>
            <Text
              style={{
                color: theme.colors.ink,
                fontSize: 20,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {props.task.title}
            </Text>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.type.meta,
                marginTop: 12,
                textAlign: "center",
              }}
            >
              Drag toward a label
            </Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  throwArea: {
    flex: 1,
    minHeight: 280,
    justifyContent: "center",
  },
  cardStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  throwCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 28,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 8px 16px rgba(20, 34, 30, 0.08)" } as object)
      : {
          shadowColor: "#14221E",
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 3,
        }),
  },
  throwPress: {
    minHeight: 88,
    justifyContent: "center",
  },
  edgeLabel: {
    position: "absolute",
    fontSize: 15,
    fontWeight: "700",
  },
  edgeTop: { top: 12 },
  edgeBottom: { bottom: 12 },
  edgeLeft: { left: 12 },
  edgeRight: { right: 12 },
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  countCell: {
    width: "47%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  focusedList: {
    maxHeight: 220,
  },
});
