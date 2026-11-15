import type { TaskTodo } from "@yatma/core";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../../theme/theme";
import { IconButton } from "../../ui";

/** Text-only checklist; Enter commits before opening the next blank editor. */
export function TaskTodosEditor(props: {
  todos: readonly TaskTodo[];
  onSave: (todos: readonly TaskTodo[]) => Promise<unknown>;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function commit(todos: readonly TaskTodo[], next: number | null = null) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await props.onSave(todos);
      setEditing(next);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save todos.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function save(another: boolean) {
    if (editing === null || !draft.trim()) return;
    const todos = [...props.todos];
    todos[editing] = { text: draft.trim(), done: todos[editing]?.done ?? false };
    void commit(todos, another && todos.length < 200 ? todos.length : null);
  }
  function add() {
    if (editing !== null && draft.trim()) save(true);
    else {
      setEditing(props.todos.length);
      setDraft("");
    }
  }
  const editor = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <TextInput
        key={editing}
        autoFocus
        accessibilityLabel="Todo text"
        placeholder="Add a todo"
        placeholderTextColor={theme.colors.muted}
        value={draft}
        onChangeText={setDraft}
        editable={!pending}
        maxLength={500}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => save(true)}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          paddingHorizontal: 12,
          backgroundColor: theme.colors.surface,
          color: theme.colors.ink,
          fontSize: 16,
        }}
      />
      <IconButton
        name="checkmark-outline"
        accessibilityLabel="Save todo"
        onPress={() => save(false)}
        disabled={pending || !draft.trim()}
      />
      <IconButton
        name="close-outline"
        accessibilityLabel="Cancel todo edit"
        onPress={() => {
          setEditing(null);
          setDraft("");
        }}
        disabled={pending}
      />
    </View>
  );
  return (
    <View style={{ marginTop: 20, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.colors.ink }}>
          Todos
        </Text>
        <IconButton
          name="add-outline"
          accessibilityLabel="Add todo"
          onPress={add}
          disabled={pending || props.todos.length >= 200}
        />
      </View>
      {props.todos.map((todo, index) =>
        editing === index ? (
          <View key={index}>{editor}</View>
        ) : (
          <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={todo.text}
              accessibilityState={{ checked: todo.done, disabled: pending || editing !== null }}
              disabled={pending || editing !== null}
              onPress={() =>
                void commit(
                  props.todos.map((item, i) =>
                    i === index ? { ...item, done: !item.done } : item,
                  ),
                  editing,
                )
              }
              style={{ width: 36, minHeight: 44, justifyContent: "center", alignItems: "center" }}
            >
              <Ionicons
                name={todo.done ? "checkbox" : "square-outline"}
                size={21}
                color={todo.done ? theme.colors.pine : theme.colors.muted}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit todo: ${todo.text}`}
              disabled={pending || editing !== null}
              onPress={() => {
                setEditing(index);
                setDraft(todo.text);
              }}
              style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
            >
              <Text
                style={{
                  color: todo.done ? theme.colors.muted : theme.colors.ink,
                  fontSize: 16,
                  textDecorationLine: todo.done ? "line-through" : "none",
                }}
              >
                {todo.text}
              </Text>
            </Pressable>
            <IconButton
              name="close-outline"
              accessibilityLabel="Remove todo"
              disabled={pending || editing !== null}
              onPress={() => void commit(props.todos.filter((_, i) => i !== index))}
              size={18}
            />
          </View>
        ),
      )}
      {editing === props.todos.length ? editor : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
