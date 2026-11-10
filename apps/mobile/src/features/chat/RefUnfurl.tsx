import {
  classifyRefPlacement,
  parseRefHref,
  type EntityRef,
} from "@yatma/core";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectPage, selectTask } from "../../state/selectors";
import { useTheme } from "../../theme/theme";

export type RefKind = EntityRef["kind"];

export type ParsedRef = {
  readonly kind: RefKind;
  readonly id: string;
  readonly label: string;
  readonly block: boolean;
};

/** Parse markdown-style refs using @yatma/core parsers. */
export function parseRefs(text: string): {
  readonly plain: string;
  readonly refs: ParsedRef[];
} {
  const refs: ParsedRef[] = [];
  const lines = text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const markdown = /\[([^\]]*)\]\((task|page|chat):([^\s)]+)\)/g;
    for (const match of line.matchAll(markdown)) {
      const parsed = parseRefHref(`${match[2]}:${match[3]}`, match[1] ?? "");
      if (parsed.ok) {
        refs.push({
          kind: parsed.ref.kind,
          id: parsed.ref.id,
          label: parsed.ref.label || parsed.ref.id,
          block: classifyRefPlacement(text, lineIndex) !== "chip",
        });
      }
    }
  }
  return { plain: text, refs };
}

type RefUnfurlProps = {
  readonly refItem: ParsedRef;
  readonly taskLinksOnly?: boolean;
};

/** Render a live chip or standalone card for a referenced entity. */
export function RefUnfurl(props: RefUnfurlProps) {
  const { refItem } = props;
  const theme = useTheme();
  const folded = useFoldedState();

  if (refItem.kind === "task") {
    const task = selectTask(folded, refItem.id);
    if (!task) return <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>{refItem.label}</Text>;
    const href = `/task/${task.id}` as const;
    return refItem.block && !props.taskLinksOnly ? (
      <TaskRow taskId={task.id} />
    ) : (
      <Link href={href} asChild>
        <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta }}>{task.title}</Text>
        </Pressable>
      </Link>
    );
  }

  if (refItem.kind === "page") {
    const page = selectPage(folded, refItem.id);
    if (!page) return <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>{refItem.label}</Text>;
    return (
      <Link href={`/page/${page.id}`} asChild>
        <Pressable style={[styles.block, { borderColor: theme.colors.line, backgroundColor: theme.colors.surface }]}>
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>Page</Text>
          <Text style={{ marginTop: 4, color: theme.colors.ink, fontSize: theme.type.row, fontWeight: "500" }}>{page.title}</Text>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/chat/${refItem.id}`} asChild>
      <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.meta }}>{refItem.label}</Text>
      </Pressable>
    </Link>
  );
}

type TaskRowProps = {
  readonly taskId: string;
  readonly commentary?: string;
};

function TaskRow(props: TaskRowProps) {
  const theme = useTheme();
  const folded = useFoldedState();
  const store = useAppStore();
  const task = selectTask(folded, props.taskId);
  const [saving, setSaving] = useState(false);
  if (!task) return null;
  const currentTask = task;
  const completed = currentTask.status === "done";

  async function toggleTask() {
    if (saving) return;
    setSaving(true);
    try {
      await store.executeLocalCommands([{
        type: "task.update",
        input: { taskId: currentTask.id, status: completed ? "todo" : "done" },
      }]);
    } catch (error) {
      Alert.alert("Could not update task", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.taskRow}>
      <Pressable
        onPress={() => void toggleTask()}
        disabled={saving}
        accessibilityRole="checkbox"
        accessibilityLabel={`${completed ? "Reopen" : "Complete"} ${currentTask.title}`}
        accessibilityState={{ checked: completed, disabled: saving }}
        hitSlop={8}
        style={styles.checkTarget}
      >
        <View style={[styles.circle, {
          borderColor: completed ? theme.colors.pine : theme.colors.muted,
          backgroundColor: completed ? theme.colors.pine : "transparent",
        }]}>
          {completed ? <Text style={{ color: theme.colors.onPine, fontSize: 12, fontWeight: "700" }}>✓</Text> : null}
        </View>
      </Pressable>
      <Link href={`/task/${currentTask.id}`} asChild>
        <Pressable style={styles.taskCopy} accessibilityRole="link" accessibilityLabel={`Open task: ${currentTask.title}`}>
          <Text style={{ color: theme.colors.ink, fontSize: theme.type.row, fontWeight: "700" }}>
            {currentTask.title}
            {props.commentary ? <Text style={{ fontWeight: "400" }}> — {props.commentary}</Text> : null}
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

type TaskLine = { readonly taskId: string; readonly label: string; readonly commentary?: string };
type MessageLine =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "ref"; readonly ref: ParsedRef }
  | { readonly type: "taskList"; readonly rows: readonly TaskLine[] };

const TASK_LINE = /^\s*\[([^\]]*)\]\(task:([^\s)]+)\)(?:\s*[—–-]\s*(.*))?\s*$/;
const SINGLE_REF_LINE = /^\s*\[([^\]]*)\]\((task|page|chat):([^\s)]+)\)\s*$/;

function parseMessageLines(text: string): MessageLine[][] {
  const rawLines = text.split("\n");
  const output: MessageLine[][] = [];
  let index = 0;
  while (index < rawLines.length) {
    const line = rawLines[index] ?? "";
    const task = TASK_LINE.exec(line);
    const parsedTask = task ? parseRefHref(`task:${task[2]}`, task[1] ?? "") : null;
    if (task && parsedTask?.ok) {
      const rows: TaskLine[] = [];
      while (index < rawLines.length) {
        const candidate = TASK_LINE.exec(rawLines[index] ?? "");
        if (!candidate) break;
        const parsed = parseRefHref(`task:${candidate[2]}`, candidate[1] ?? "");
        if (!parsed.ok) break;
        rows.push({ taskId: parsed.ref.id, label: parsed.ref.label || parsed.ref.id, ...(candidate[3]?.trim() ? { commentary: candidate[3].trim() } : {}) });
        index += 1;
      }
      output.push([{ type: "taskList", rows }]);
      continue;
    }

    const standalone = SINGLE_REF_LINE.exec(line);
    if (standalone) {
      const parsed = parseRefHref(`${standalone[2]}:${standalone[3]}`, standalone[1] ?? "");
      if (parsed.ok) {
        output.push([{ type: "ref", ref: {
          kind: parsed.ref.kind,
          id: parsed.ref.id,
          label: parsed.ref.label || parsed.ref.id,
          block: true,
        } }]);
        index += 1;
        continue;
      }
    }

    output.push(parseInlineLine(line));
    index += 1;
  }
  return output;
}

function parseInlineLine(line: string): MessageLine[] {
  const matches = [...line.matchAll(/\[([^\]]*)\]\((task|page|chat):([^\s)]+)\)/g)];
  if (matches.length === 0) return [{ type: "text", text: line }];
  const parts: MessageLine[] = [];
  let cursor = 0;
  for (const match of matches) {
    const offset = match.index ?? cursor;
    if (offset > cursor) parts.push({ type: "text", text: line.slice(cursor, offset) });
    const parsed = parseRefHref(`${match[2]}:${match[3]}`, match[1] ?? "");
    if (parsed.ok) {
      parts.push({ type: "ref", ref: {
        kind: parsed.ref.kind,
        id: parsed.ref.id,
        label: parsed.ref.label || parsed.ref.id,
        block: false,
      } });
    } else {
      parts.push({ type: "text", text: match[0] ?? "" });
    }
    cursor = offset + (match[0]?.length ?? 0);
  }
  if (cursor < line.length) parts.push({ type: "text", text: line.slice(cursor) });
  return parts;
}

type MessageBodyProps = {
  readonly text: string;
  readonly taskLinksOnly?: boolean;
};

/** Render assistant text with inline refs and live grouped task rows. */
export function MessageWithRefs(props: MessageBodyProps) {
  const theme = useTheme();
  const lines = parseMessageLines(props.text);
  return (
    <View style={styles.message}>
      {lines.map((line, lineIndex) => (
        <View key={`line-${lineIndex}`} style={styles.messageLine}>
          {line.map((part, partIndex) => {
            if (part.type === "taskList") {
              return props.taskLinksOnly ? <View key={`tasks-${partIndex}`} style={styles.taskList}>{part.rows.map((row, index) => <View key={`${row.taskId}:${index}`} style={styles.messageLine}><RefUnfurl refItem={{ kind: "task", id: row.taskId, label: row.label, block: false }} taskLinksOnly />{row.commentary ? <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>{row.commentary}</Text> : null}</View>)}</View> : <TaskList key={`tasks-${partIndex}`} rows={part.rows} />;
            }
            if (part.type === "ref") {
              return <RefUnfurl key={`${part.ref.kind}:${part.ref.id}:${partIndex}`} refItem={part.ref} taskLinksOnly={props.taskLinksOnly} />;
            }
            return <Text key={`text-${partIndex}`} style={{ color: theme.colors.ink, fontSize: theme.type.row }}>{part.text}</Text>;
          })}
        </View>
      ))}
    </View>
  );
}

function TaskList(props: { readonly rows: readonly TaskLine[] }) {
  const folded = useFoldedState();
  const theme = useTheme();
  const items = props.rows.flatMap((row) => {
    const task = selectTask(folded, row.taskId);
    return task ? [{ row, task }] : [];
  });
  const completed = items.filter(({ task }) => task.status === "done");
  const outstanding = items.filter(({ task }) => task.status !== "done");
  return (
    <View style={styles.taskList}>
      {completed.length ? (
        <View style={styles.taskGroup}>
          <Text style={[styles.groupHeading, { color: theme.colors.muted }]}>Completed{completed[0]?.task.completedAt ? ` — ${new Date(completed[0].task.completedAt).toLocaleDateString()}` : ""}</Text>
          {completed.map(({ row, task }) => <TaskRow key={task.id} taskId={task.id} commentary={row.commentary} />)}
        </View>
      ) : null}
      {outstanding.length ? (
        <View style={styles.taskGroup}>
          <Text style={[styles.groupHeading, { color: theme.colors.muted }]}>Still outstanding</Text>
          {outstanding.map(({ row, task }) => <TaskRow key={task.id} taskId={task.id} commentary={row.commentary} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  message: { gap: 8 },
  messageLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  taskList: { width: "100%", gap: 14, paddingVertical: 4 },
  taskGroup: { gap: 4 },
  groupHeading: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", width: "100%", minHeight: 40 },
  checkTarget: { width: 40, minHeight: 40, alignItems: "flex-start", justifyContent: "center", paddingLeft: 4 },
  circle: { width: 20, height: 20, borderWidth: 1.5, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  taskCopy: { flex: 1, minWidth: 0, justifyContent: "center", minHeight: 40, paddingVertical: 6 },
});
