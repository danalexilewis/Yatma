import { generateEventId } from "@yatma/core";
import { useEffect, useLayoutEffect, useId, useRef, useState, type ComponentRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  Text,
  View,
  type TextInput,
  type TextInputProps,
} from "react-native";

import { parseComposerInput } from "./composerInput";
import {
  findMentionQuery,
  insertMention,
  selectMentionSuggestions,
  selectionAfterTextChange,
  type ComposerSelection,
  type MentionSuggestion,
} from "./mentions";
import { showThreadTasks } from "../../application/threadCapture";
import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";
import { Composer } from "../../ui";

type ThreadComposerProps = {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onMessage: (text: string) => Promise<void>;
  readonly onLocalReply?: () => void;
  readonly onMic?: () => void;
  readonly busy?: boolean;
  readonly onStop?: () => void;
  readonly tabBarPad?: boolean;
  readonly submitRef?: { current: ((text: string) => Promise<void>) | null };
};

/** Ordinary conversation input with local /list and committed-entity mention selection. */
export function ThreadComposer(props: ThreadComposerProps) {
  const theme = useTheme();
  const store = useAppStore();
  const suggestionsId = useId();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const pendingCaret = useRef<{
    readonly text: string;
    readonly selection: ComposerSelection;
  } | null>(null);
  const suggestionScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const suggestionLayouts = useRef(new Map<string, number>());
  const { height: viewportHeight } = useWindowDimensions();
  const suggestionHeight = Math.min(360, Math.max(144, viewportHeight * 0.38));
  const [selection, setSelection] = useState<ComposerSelection>({
    start: props.value.length,
    end: props.value.length,
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const listIdentity = useRef<string | null>(null);
  const locallyEditedValue = useRef(props.value);
  const latestValue = useRef(props.value);
  latestValue.current = props.value;
  const account = useRef({ id: store.state.accountId, generation: 0 });
  if (account.current.id !== store.state.accountId)
    account.current = { id: store.state.accountId, generation: account.current.generation + 1 };
  const mention = findMentionQuery(props.value, selection);
  const queryKey = mention ? JSON.stringify([props.value, mention.start, mention.end]) : null;
  const candidates = mention ? selectMentionSuggestions(store.state.folded, mention) : [];
  const suggestions = candidates.slice(0, 8);
  const showMentions = mention !== null && dismissedQuery !== queryKey;
  const showListCommand =
    !showMentions && /^\/(?:l(?:i(?:s(?:t)?)?)?)?$/i.test(props.value.trimStart());
  const selectedIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1));
  const disabled = saving || props.busy;

  useEffect(() => {
    savingRef.current = false;
    listIdentity.current = null;
    setSaving(false);
    setError(null);
    setDismissedQuery(null);
  }, [store.state.accountId]);

  useEffect(() => {
    const selected = suggestions[selectedIndex];
    const offset = selected
      ? suggestionLayouts.current.get(`${selected.kind}:${selected.id}`)
      : undefined;
    if (showMentions && offset !== undefined)
      suggestionScroll.current?.scrollTo({ y: Math.max(0, offset - 4), animated: false });
  }, [selectedIndex, queryKey, showMentions]);

  useEffect(() => {
    if (props.value !== locallyEditedValue.current) {
      locallyEditedValue.current = props.value;
      setSelection({ start: props.value.length, end: props.value.length });
    }
  }, [props.value]);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending || pending.text !== props.value) return;
    let settleFrame: number | undefined;
    const applyFrame = requestAnimationFrame(() => {
      if (pendingCaret.current !== pending || latestValue.current !== pending.text) return;
      input.current?.focus();
      const node: unknown = input.current;
      if (
        Platform.OS === "web" &&
        (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement)
      ) {
        node.setSelectionRange(pending.selection.start, pending.selection.end);
      } else if (Platform.OS !== "web")
        input.current?.setSelection(pending.selection.start, pending.selection.end);
      setSelection({ ...pending.selection });
      settleFrame = requestAnimationFrame(() => {
        if (pendingCaret.current === pending) pendingCaret.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(applyFrame);
      if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
    };
  }, [props.value]);

  function changeText(text: string) {
    pendingCaret.current = null;
    setActiveIndex(0);
    setDismissedQuery(null);
    locallyEditedValue.current = text;
    setSelection(selectionAfterTextChange(props.value, text, selection));
    props.onChangeText(text);
  }
  function chooseMention(suggestion: MentionSuggestion) {
    if (!mention || disabled) return;
    const result = insertMention(props.value, mention, suggestion, store.state.folded);
    if (!result) {
      setError("That item changed or is unavailable. Search for it again.");
      return;
    }
    setError(null);
    setActiveIndex(0);
    pendingCaret.current = { text: result.text, selection: result.selection };
    locallyEditedValue.current = result.text;
    props.onChangeText(result.text);
    setSelection(result.selection);
    requestAnimationFrame(() => input.current?.focus());
  }
  function chooseListCommand() {
    pendingCaret.current = { text: "/list", selection: { start: 5, end: 5 } };
    locallyEditedValue.current = "/list";
    props.onChangeText("/list");
    setSelection({ start: 5, end: 5 });
    requestAnimationFrame(() => input.current?.focus());
  }
  async function send(textOverride?: string) {
    const submitted = textOverride ?? props.value;
    const request = parseComposerInput(submitted);
    if ((request.kind === "message" && !request.text) || savingRef.current || props.busy) return;
    const generation = account.current.generation;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setDismissedQuery(queryKey);
    try {
      if (request.kind === "list") {
        listIdentity.current ??= `tasks_${generateEventId()}`;
        await showThreadTasks(store, listIdentity.current);
        if (generation !== account.current.generation) return;
        listIdentity.current = null;
        props.onLocalReply?.();
      } else await props.onMessage(request.text);
      if (
        generation === account.current.generation &&
        textOverride === undefined &&
        latestValue.current === submitted
      ) {
        props.onChangeText("");
        setSelection({ start: 0, end: 0 });
      }
    } catch (cause) {
      if (generation !== account.current.generation) return;
      setError(cause instanceof Error ? cause.message : "Could not save your message. Try again.");
      if (textOverride !== undefined && !latestValue.current.trim()) props.onChangeText(submitted);
    } finally {
      if (generation === account.current.generation) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  const onKeyPress: TextInputProps["onKeyPress"] = (event) => {
    const key = event.nativeEvent.key;
    if ("isComposing" in event.nativeEvent && event.nativeEvent.isComposing) return;
    if (showMentions && suggestions.length && (key === "ArrowDown" || key === "ArrowUp")) {
      event.preventDefault();
      setActiveIndex(
        (index) =>
          (index + (key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (showMentions && suggestions.length && (key === "Enter" || key === "Tab")) {
      event.preventDefault();
      chooseMention(suggestions[selectedIndex]!);
      return;
    }
    if (showMentions && key === "Escape") {
      event.preventDefault();
      setDismissedQuery(queryKey);
      return;
    }
    if (showListCommand && key === "Tab") {
      event.preventDefault();
      chooseListCommand();
      return;
    }
    if (
      Platform.OS === "web" &&
      key === "Enter" &&
      !("shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey)
    ) {
      event.preventDefault();
      void send();
    }
  };
  if (props.submitRef) props.submitRef.current = send;

  return (
    <View style={[styles.dock, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.column}>
        {error ? (
          <Text accessibilityRole="alert" style={[styles.help, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {showMentions ? (
          <View
            nativeID={suggestionsId}
            role="list"
            aria-label="Entity mention suggestions"
            style={[
              styles.suggestions,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
            ]}
          >
            <Text style={[styles.help, { color: theme.colors.muted }]}>
              {candidates.length
                ? `${suggestions.length} of ${candidates.length} matches · ↑↓ select · Enter or Tab inserts`
                : "No matching items. Try another title, project, or ID."}
            </Text>
            <ScrollView
              ref={suggestionScroll}
              style={{ maxHeight: suggestionHeight }}
              keyboardShouldPersistTaps="always"
            >
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={`${suggestion.kind}:${suggestion.id}`}
                  nativeID={`${suggestionsId}-${index}`}
                  onLayout={(event) => {
                    const offset = event.nativeEvent.layout.y;
                    suggestionLayouts.current.set(`${suggestion.kind}:${suggestion.id}`, offset);
                    if (index === selectedIndex)
                      suggestionScroll.current?.scrollTo({
                        y: Math.max(0, offset - 4),
                        animated: false,
                      });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${suggestion.label} · ${suggestion.context}`}
                  accessibilityState={{ selected: selectedIndex === index, disabled }}
                  disabled={disabled}
                  onPress={() => chooseMention(suggestion)}
                  style={[
                    styles.suggestion,
                    {
                      backgroundColor:
                        selectedIndex === index ? theme.colors.pineSoft : "transparent",
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: theme.colors.ink, fontSize: theme.type.row, fontWeight: "600" }}
                  >
                    {suggestion.label}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{ color: theme.colors.muted, fontSize: theme.type.meta }}
                  >
                    {suggestion.context}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {candidates.length > suggestions.length ? (
              <Text style={[styles.help, { color: theme.colors.muted }]}>
                Keep typing to narrow the results.
              </Text>
            ) : null}
          </View>
        ) : showListCommand ? (
          <View
            style={[
              styles.suggestions,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Insert /list command"
              disabled={disabled}
              onPress={chooseListCommand}
              style={styles.suggestion}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>/list</Text>
              <Text style={{ color: theme.colors.muted }}>
                List every open task locally, including while offline.
              </Text>
            </Pressable>
          </View>
        ) : null}
        <Composer
          value={props.value}
          onChangeText={changeText}
          inputLabel="Message Yatma"
          inputRef={input}
          selection={selection}
          onSelectionChange={(event) => {
            // A selection event queued before the committed replacement must not restore the old caret.
            if (!pendingCaret.current) setSelection(event.nativeEvent.selection);
          }}
          onKeyPress={onKeyPress}
          inputAccessibility={{
            role: "combobox",
            "aria-expanded": showMentions,
            "aria-controls": showMentions ? suggestionsId : undefined,
            "aria-activedescendant":
              showMentions && suggestions.length ? `${suggestionsId}-${selectedIndex}` : undefined,
            "aria-autocomplete": "list",
          }}
          placeholder="Plan your day, ask a question, or /list…"
          onSend={() => void send()}
          onMic={props.onMic}
          busy={disabled}
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
  help: { fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 6 },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 4,
    overflow: "hidden",
  },
  suggestion: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 7, gap: 3 },
});
