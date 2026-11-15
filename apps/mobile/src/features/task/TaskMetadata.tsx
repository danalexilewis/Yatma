import { deriveEntryTime, deriveTaskTime, type DayEntry, type Task } from "@yatma/core";
import { Text } from "react-native";

import { useStackPlayer } from "../player/PlayerProvider";
import { formatDuration } from "../player/time";
import { useTheme } from "../../theme/theme";

/** Compact committed project and lifetime effort; absent values leave no placeholder. */
export function TaskMetadata(props: {
  readonly task?: Task;
  readonly entry?: DayEntry;
  readonly color?: string;
}) {
  const player = useStackPlayer();
  const theme = useTheme();
  const folded = player.state.folded;
  const intervals = [...folded.workIntervals.values()];
  const project = props.task?.projectId ? folded.projects.get(props.task.projectId) : undefined;
  const time = props.task
    ? deriveTaskTime(props.task.id, [...folded.dayEntries.values()], intervals, player.now)
    : props.entry
      ? deriveEntryTime(props.entry, intervals, player.now)
      : undefined;
  const metadata = [
    project?.title,
    time && time.actualSeconds >= 1 ? `${formatDuration(time.actualSeconds)} worked` : undefined,
  ].filter(Boolean);
  if (!metadata.length) return null;
  return (
    <Text
      style={{
        color: props.color ?? theme.colors.muted,
        fontSize: theme.type.meta,
        marginTop: 3,
        flexShrink: 1,
      }}
    >
      {metadata.join(" · ")}
    </Text>
  );
}
