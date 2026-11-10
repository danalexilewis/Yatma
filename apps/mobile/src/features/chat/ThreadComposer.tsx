import type { BatchCommand, ProjectId } from "@yatma/core";
import {
  generateShortId,
  PERSONAL_THREAD_ID,
  ProjectId as ProjectIdSchema,
  TaskId,
} from "@yatma/core";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { parseComposerInput, type ComposerMode } from "./composerInput";
import { useAppStore } from "../../state/atoms";
import { selectActiveProjects } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { Composer, ProjectPicker } from "../../ui";

type ThreadComposerProps = {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly projectId: ProjectId | null;
  readonly onProjectChange: (projectId: ProjectId | null) => void;
  readonly onMessage?: (text: string) => Promise<void>;
  readonly onMic?: () => void;
  readonly busy?: boolean;
  readonly onStop?: () => void;
  readonly tabBarPad?: boolean;
  readonly mode: ComposerMode;
  readonly onModeChange: (mode: ComposerMode) => void;
  readonly submitRef?: { current: ((text: string) => Promise<void>) | null };
};

/** Task, project, and conversation capture share one dock and the atomic local writer. */
export function ThreadComposer(props: ThreadComposerProps) {
  const theme = useTheme();
  const store = useAppStore();
  const mode = props.mode;
  const setMode = props.onModeChange;
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const chatId = PERSONAL_THREAD_ID;
  const latestValue = useRef(props.value);
  latestValue.current = props.value;

  function changeText(text: string) {
    const input = parseComposerInput(text, mode);
    if (input.command) {
      setMode(input.mode);
      props.onChangeText(input.text);
      setMenuOpen(false);
    } else {
      props.onChangeText(text);
    }
  }

  function chooseMode(next: ComposerMode) {
    setMode(next);
    setMenuOpen(false);
    setError(null);
    if (props.value === "/") props.onChangeText("");
  }

  async function send(textOverride?: string) {
    const input = parseComposerInput(textOverride ?? props.value, mode);
    const text = input.text.trim();
    const submitMode = input.mode;
    if (!text || savingRef.current || props.busy) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (submitMode === "message" && props.onMessage) {
        await props.onMessage(text);
      } else {
        const commands: BatchCommand[] = [];
        const chat = store.state.folded.chats.get(chatId);
        let createdProjectId: ProjectId | null = null;
        if (submitMode === "message" && !chat) {
          commands.push({
            type: "chat.create",
            chatId,
            input: { projectId: null, title: "My thread" },
          });
        }
        if (submitMode === "task") {
          commands.push({
            type: "task.create",
            taskId: TaskId.make(generateShortId("t_")),
            input: {
              title: text,
              projectId: props.projectId,
            },
          });
        } else if (submitMode === "project") {
          createdProjectId = ProjectIdSchema.make(generateShortId("p_"));
          commands.push({
            type: "project.create",
            projectId: createdProjectId,
            input: { title: text },
          });
        } else {
          commands.push({
            type: "chat.message",
            chatId,
            messageId: generateShortId("c_"),
            role: "user",
            text,
          });
        }
        await store.executeLocalCommands(commands);
        if (submitMode === "project") {
          props.onProjectChange(createdProjectId);
          setMode("task");
        }
        if (textOverride === undefined && latestValue.current === props.value)
          props.onChangeText("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (props.submitRef) props.submitRef.current = send;

  return (
    <View style={[styles.dock, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.column}>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.type.meta,
              paddingHorizontal: 16,
              paddingVertical: 6,
            }}
          >
            {error}
          </Text>
        ) : null}
        {menuOpen || props.value === "/" ? (
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
            ]}
          >
            {(["task", "message", "project"] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="menuitem"
                accessibilityLabel={`${item === "task" ? "Task" : item === "message" ? "Message" : "Project"} mode`}
                accessibilityState={{ selected: mode === item, disabled: saving || props.busy }}
                disabled={saving || props.busy}
                onPress={() => chooseMode(item)}
                style={[
                  styles.menuItem,
                  { backgroundColor: mode === item ? theme.colors.pineSoft : "transparent" },
                ]}
              >
                <Ionicons
                  name={
                    item === "task"
                      ? "ellipse-outline"
                      : item === "project"
                        ? "folder-outline"
                        : "chatbubble-outline"
                  }
                  size={18}
                  color={theme.colors.pine}
                />
                <Text style={{ flex: 1, color: theme.colors.ink, fontSize: 15 }}>
                  {item === "task" ? "Task" : item === "message" ? "Message" : "Project"}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>/{item}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {mode === "task" ? (
          <View style={styles.selectedProject}>
            <ProjectPicker
              projects={selectActiveProjects(store.state.folded)}
              value={props.projectId}
              onChange={props.onProjectChange}
              disabled={saving || props.busy}
            />
          </View>
        ) : null}
        <Composer
          value={props.value}
          onChangeText={changeText}
          inputLabel={mode === "task" ? "Task" : mode === "project" ? "Project" : "Message"}
          modeControl={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Composer mode"
              accessibilityState={{ expanded: menuOpen }}
              disabled={saving || props.busy}
              onPress={() => setMenuOpen(!menuOpen)}
              style={styles.mode}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 13, fontWeight: "600" }}>
                {mode === "task" ? "Task" : mode === "project" ? "Project" : "Message"}
              </Text>
              <Ionicons name="chevron-down" color={theme.colors.muted} size={13} />
            </Pressable>
          }
          placeholder={
            mode === "task"
              ? "Add a task…"
              : mode === "project"
                ? "Name a project…"
                : "Message, or /task to add a task…"
          }
          onSend={() => void send()}
          onMic={props.onMic}
          busy={saving || props.busy}
          onStop={props.busy ? props.onStop : undefined}
          tabBarPad={props.tabBarPad}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { width: "100%" },
  column: { width: "100%", maxWidth: 760, alignSelf: "center", zIndex: 1 },
  mode: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  menu: {
    position: "absolute",
    bottom: "100%",
    left: 20,
    width: 264,
    borderWidth: 1,
    borderRadius: 14,
    padding: 6,
    boxShadow: "0px 4px 20px rgba(0, 0, 0, 0.12)",
    zIndex: 5,
  },
  menuItem: {
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  selectedProject: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
});
