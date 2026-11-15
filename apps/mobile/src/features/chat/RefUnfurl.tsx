import { classifyRefPlacement, extractRefs, type EntityRef } from "@yatma/core";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { parseMessageParts, type MessagePart } from "./messageParts";
import { TaskMetadata } from "../task/TaskMetadata";
import { useTaskInteraction } from "../task/useTaskInteraction";
import { useTaskNavigation } from "../task/useTaskNavigation";
import { useFoldedState } from "../../state/atoms";
import { selectPage } from "../../state/selectors";
import { useTheme } from "../../theme/theme";

export type RefKind = EntityRef["kind"];
export type ParsedRef = {
  readonly kind: RefKind;
  readonly id: string;
  readonly label: string;
  readonly block: boolean;
};

/** Compatibility parser for consumers needing valid entity references. */
export function parseRefs(text: string): { readonly plain: string; readonly refs: ParsedRef[] } {
  return {
    plain: text,
    refs: text.split("\n").flatMap((line, index) =>
      extractRefs(line).map((ref) => ({
        ...ref,
        block: classifyRefPlacement(text, index) !== "chip",
      })),
    ),
  };
}

/** Renders a live reference without copying entity data into the historical message. */
export function RefUnfurl(props: {
  readonly refItem: ParsedRef;
  readonly taskLinksOnly?: boolean;
}) {
  const theme = useTheme();
  const folded = useFoldedState();
  const navigation = useTaskNavigation();
  const ref = props.refItem;
  if (ref.kind === "task") {
    if (ref.block && !props.taskLinksOnly) return <TaskBlock taskId={ref.id} label={ref.label} />;
    const task = [...folded.tasks.values()].find((item) => item.id === ref.id);
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => navigation.openTask(ref.id)}
        style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}
      >
        <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta }}>
          {task?.title ?? ref.label}
          {task?.deletedAt ? " (deleted)" : !task ? " (unavailable)" : ""}
        </Text>
      </Pressable>
    );
  }
  if (ref.kind === "project") {
    const project = [...folded.projects.values()].find((item) => item.id === ref.id);
    if (!project)
      return <Text style={{ color: theme.colors.muted }}>{ref.label} (project unavailable)</Text>;
    return (
      <Link href={`/project/${project.id}/overview`} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open project: ${project.title}${project.archivedAt ? " (archived)" : ""}`}
          style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}
        >
          <Text style={{ color: theme.colors.pine }}>
            {project.title}
            {project.archivedAt ? " (archived)" : ""}
          </Text>
        </Pressable>
      </Link>
    );
  }
  if (ref.kind === "page") {
    const page = selectPage(folded, ref.id);
    if (!page)
      return <Text style={{ color: theme.colors.muted }}>{ref.label} (page unavailable)</Text>;
    return (
      <Link href={`/page/${page.id}`} asChild>
        <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
          <Text style={{ color: theme.colors.pine }}>{page.title}</Text>
        </Pressable>
      </Link>
    );
  }
  return (
    <Link href={`/chat/${ref.id}`} asChild>
      <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
        <Text style={{ color: theme.colors.pine }}>{ref.label}</Text>
      </Pressable>
    </Link>
  );
}

/** Shared controls retain every occurrence and publish only the account's committed task state. */
export function TaskBlock(props: {
  readonly taskId: string;
  readonly label: string;
  readonly commentary?: string;
  readonly prefix?: string;
}) {
  const theme = useTheme();
  const navigation = useTaskNavigation();
  const interaction = useTaskInteraction(props.taskId);
  const task = interaction.task;
  const disabled = interaction.pending || interaction.availability !== "available";
  const completed = task?.status === "done";
  async function changeStatus() {
    try {
      await interaction.setStatus(completed ? "todo" : "done");
    } catch {
      /* The account coordinator exposes the retryable error to every occurrence. */
    }
  }
  return (
    <View style={styles.taskContainer}>
      <View style={styles.taskRow}>
        {props.prefix?.trim() ? (
          <Text style={{ color: theme.colors.muted, paddingTop: 12 }}>{props.prefix.trim()}</Text>
        ) : null}
        <Pressable
          onPress={() => void changeStatus()}
          disabled={disabled}
          accessibilityRole="checkbox"
          aria-checked={completed}
          aria-disabled={disabled}
          aria-busy={interaction.pending}
          accessibilityLabel={`${completed ? "Reopen" : "Complete"} ${task?.title ?? props.label}`}
          accessibilityState={{ checked: completed, disabled, busy: interaction.pending }}
          style={styles.checkTarget}
        >
          <View
            style={[
              styles.circle,
              {
                borderColor: completed ? theme.colors.pine : theme.colors.muted,
                backgroundColor: completed ? theme.colors.pine : "transparent",
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            {completed ? (
              <Text style={{ color: theme.colors.onPine, fontWeight: "700" }}>✓</Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open task: ${task?.title ?? props.label}`}
          onPress={() => navigation.openTask(props.taskId)}
          style={styles.taskCopy}
        >
          <Text
            style={{
              color: theme.colors.ink,
              fontSize: theme.type.row,
              fontWeight: "600",
              lineHeight: 24,
            }}
          >
            {task?.title ?? props.label}
          </Text>
          {!task || task.deletedAt ? (
            <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginTop: 3 }}>
              {!task ? "Task unavailable" : "Deleted task"}
            </Text>
          ) : (
            <TaskMetadata task={task} />
          )}
        </Pressable>
      </View>
      {props.commentary ? (
        <Text style={{ marginLeft: 40, color: theme.colors.ink, fontSize: theme.type.row }}>
          {props.commentary}
        </Text>
      ) : null}
      {interaction.error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void changeStatus()}
          disabled={disabled}
        >
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.danger, fontSize: theme.type.meta }}
          >
            {interaction.error} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MessagePartView(props: {
  readonly part: MessagePart;
  readonly taskLinksOnly?: boolean;
}) {
  const theme = useTheme();
  const part = props.part;
  if (part.kind === "task") {
    return props.taskLinksOnly ? (
      <View style={styles.line}>
        <RefUnfurl refItem={{ kind: "task", id: part.taskId, label: part.label, block: false }} />
        {part.commentary ? (
          <Text style={{ color: theme.colors.ink }}>{part.commentary}</Text>
        ) : null}
      </View>
    ) : (
      <TaskBlock
        taskId={part.taskId}
        label={part.label}
        commentary={part.commentary}
        prefix={part.prefix}
      />
    );
  }
  return (
    <View style={styles.line}>
      {part.parts.map((item, index) =>
        item.kind === "ref" ? (
          <RefUnfurl key={index} refItem={{ ...item.ref, block: false }} />
        ) : (
          <Text
            key={index}
            style={{ color: theme.colors.ink, fontSize: theme.type.row, lineHeight: 25 }}
          >
            {item.text || " "}
          </Text>
        ),
      )}
    </View>
  );
}

/** Shared parser also renders compact messages outside the virtualized permanent thread. */
export function MessageWithRefs(props: {
  readonly text: string;
  readonly taskLinksOnly?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      {parseMessageParts(props.text).map((part) => (
        <MessagePartView key={part.index} part={part} taskLinksOnly={props.taskLinksOnly} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, alignSelf: "flex-start" },
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", minHeight: 10, gap: 3 },
  taskContainer: { width: "100%", paddingVertical: 4 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", width: "100%", minHeight: 48 },
  checkTarget: { width: 40, minHeight: 48, alignItems: "center", justifyContent: "center" },
  circle: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  taskCopy: { flex: 1, minWidth: 0, justifyContent: "center", minHeight: 48, paddingVertical: 5 },
});
