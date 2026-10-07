import { Slot, useLocalSearchParams, useNavigation, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { useFoldedState } from "../../../src/state/atoms";
import { selectProject } from "../../../src/state/selectors";
import { useTheme } from "../../../src/theme/theme";
import { SegmentedControl } from "../../../src/ui";

const SEGMENTS = [
  { key: "tasks", label: "Tasks" },
  { key: "chats", label: "Chats" },
  { key: "handbook", label: "Handbook" },
  { key: "context", label: "Context" },
] as const;

type SectionKey = (typeof SEGMENTS)[number]["key"];

export default function ProjectLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folded = useFoldedState();
  const project = id ? selectProject(folded, id) : undefined;
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const segments = useSegments();

  const last = segments[segments.length - 1];
  const active: SectionKey =
    last === "chats" || last === "handbook" || last === "context" || last === "tasks"
      ? last
      : "tasks";

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: project?.title ?? "Project",
    });
  }, [navigation, project?.title]);

  function onSegment(key: string) {
    if (!id || key === active) return;
    router.replace(`/project/${id}/${key}`);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.segmentWrap}>
        <SegmentedControl segments={SEGMENTS} value={active} onChange={onSegment} />
      </View>
      <View style={styles.body}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  segmentWrap: { paddingTop: 8, paddingBottom: 8 },
  body: { flex: 1 },
});
