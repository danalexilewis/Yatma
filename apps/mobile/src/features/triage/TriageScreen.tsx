import type { Quadrant, Task } from "@yatma/core";
import { TaskId as TaskIdSchema } from "@yatma/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectInboxTasks, selectQuadrantTasks } from "../../state/selectors";
import { colors } from "../../theme/colors";

const QUADRANTS: ReadonlyArray<{
  readonly key: Quadrant;
  readonly label: string;
  readonly color: string;
}> = [
  { key: "do", label: "Do", color: colors.do },
  { key: "schedule", label: "Schedule", color: colors.schedule },
  { key: "delegate", label: "Delegate", color: colors.delegate },
  { key: "eliminate", label: "Eliminate", color: colors.eliminate },
];

const SWIPE_THRESHOLD = 64;

/** 2×2 Eisenhower matrix plus swipeable Inbox tray. */
export function TriageScreen() {
  const router = useRouter();
  const folded = useFoldedState();
  const { updateTask } = useAppStore();
  const inbox = selectInboxTasks(folded);
  const topInbox = inbox[0];

  async function triage(task: Task, quadrant: Quadrant) {
    await updateTask({ taskId: TaskIdSchema.make(task.id), quadrant });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <Text className="mb-3 text-2xl font-bold text-slate-900 dark:text-slate-50">Triage</Text>

      <View className="mb-4 flex-row flex-wrap gap-2">
        {QUADRANTS.map((quadrant) => {
          const tasks = selectQuadrantTasks(folded, quadrant.key);
          const top = tasks.slice(0, 2);
          return (
            <View
              key={quadrant.key}
              className="w-[48%] rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="font-semibold" style={{ color: quadrant.color }}>
                  {quadrant.label}
                </Text>
                <Text className="text-sm text-slate-500">{tasks.length}</Text>
              </View>
              {top.length === 0 ? (
                <Text className="text-xs text-slate-400">Empty</Text>
              ) : (
                top.map((task) => (
                  <Pressable key={task.id} onPress={() => router.push(`/task/${task.id}`)}>
                    <Text
                      className="mb-1 text-sm text-slate-800 dark:text-slate-100"
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          );
        })}
      </View>

      <View className="mb-8 rounded-2xl border border-dashed border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
        <Text className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Inbox tray · {inbox.length}
        </Text>
        <Text className="mb-3 text-xs text-slate-500">
          Swipe up Do · right Schedule · left Delegate · down Eliminate
        </Text>
        {topInbox ? (
          <InboxSwipeCard
            task={topInbox}
            onOpen={() => router.push(`/task/${topInbox.id}`)}
            onTriage={(quadrant) => void triage(topInbox, quadrant)}
          />
        ) : (
          <Text className="text-sm text-slate-500">Inbox is clear.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function InboxSwipeCard(props: {
  readonly task: Task;
  readonly onOpen: () => void;
  readonly onTriage: (quadrant: Quadrant) => void;
}) {
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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          animatedStyle,
          {
            backgroundColor: `${colors.inbox}14`,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 16,
          },
        ]}
      >
        <Pressable onPress={props.onOpen}>
          <Text className="text-base font-medium text-slate-900 dark:text-slate-50">
            {props.task.title}
          </Text>
          <Text className="mt-2 text-xs text-slate-500">
            ↑ Do · → Schedule · ← Delegate · ↓ Eliminate
          </Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
