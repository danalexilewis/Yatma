import { LegendList } from "@legendapp/list/react-native";
import type { ChatMessage, ChatStreamItem, Event } from "@yatma/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChangeCard } from "./ChangeCard";
import { summarizeChangeEvents } from "./changeSummary";
import { MessageWithRefs } from "./RefUnfurl";
import { eventsFromUndoPlan } from "./undoBatch";
import { dictateFromMic } from "../dictation";
import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectChat } from "../../state/selectors";
import { sendChatTurn, stopChatTurn, wrapUpChat } from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { Composer, Screen } from "../../ui";

type LiveChange = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly summaryLabel: string;
};

const SUGGESTIONS = ["What's on now?", "Clear my inbox"] as const;

/** Single chat thread — or a blank new thread when id is `new`. */
export function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const navigation = useNavigation();
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const store = useAppStore();
  const chat = !isNew && id ? selectChat(folded, id) : undefined;
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(isNew ? null : id ?? null);

  async function onWrapUp() {
    if (!activeChatId) return;
    setBusy(true);
    try {
      const result = await wrapUpChat(activeChatId);
      if (result?.events?.length) {
        store.mergeRemoteEvents(result.events);
        setLiveChange({
          batchId: result.batchId,
          events: result.events,
          summaryLabel: "Handbook updated",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const showWrapUp = Boolean(activeChatId) && !isNew;
    navigation.setOptions({
      headerShown: true,
      title: chat?.title ?? (isNew ? "New chat" : "Chat"),
      headerRight: showWrapUp
        ? () => (
            <Pressable
              onPress={() => void onWrapUp()}
              disabled={busy}
              hitSlop={8}
              style={{ opacity: busy ? 0.5 : 1 }}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "600", paddingHorizontal: 8 }}>
                Wrap up
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, chat?.title, isNew, activeChatId, busy, theme.colors.pine]);

  if (!isNew && (!chat || !id)) {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.muted }}>Chat not found</Text>
        </View>
      </Screen>
    );
  }

  const messages: ChatMessage[] = chat ? [...chat.messages] : [];
  const empty = messages.length === 0 && !streaming;

  async function onMicHold() {
    const engine = getSyncEngine();
    const result = await dictateFromMic({
      callRpc: engine ? (method, payload) => engine.client.callRpc(method, payload) : undefined,
    });
    if (result.text) setDraft((prev) => (prev ? `${prev} ${result.text}` : result.text));
  }

  async function onSend(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setError(null);
    setStreaming("");
    setLiveChange(null);
    try {
      await sendChatTurn({
        chatId: activeChatId ?? undefined,
        projectId: chat?.projectId ?? null,
        text,
        handlers: {
          onItem: (item: ChatStreamItem) => {
            if (item.kind === "started") {
              setTurnId(item.turnId);
              if (item.chatId) {
                setActiveChatId(item.chatId);
                if (isNew) {
                  router.replace(`/chat/${item.chatId}`);
                }
              }
            }
            if (item.kind === "text_delta") {
              setStreaming((prev) => prev + item.text);
            }
            if (item.kind === "changes") {
              store.mergeRemoteEvents(item.events);
              setLiveChange({
                batchId: item.batchId,
                events: item.events,
                summaryLabel: item.summary,
              });
            }
            if (item.kind === "done") setTurnId(null);
          },
          onError: (err) => {
            setError(err instanceof Error ? err.message : String(err));
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    if (!activeChatId) return;
    await stopChatTurn({ chatId: activeChatId, turnId: turnId ?? undefined });
    setBusy(false);
    setTurnId(null);
  }

  async function onUndo() {
    if (!liveChange) return;
    const undoEvents = eventsFromUndoPlan({
      batchId: liveChange.batchId,
      batchEvents: liveChange.events,
      folded: store.state.folded,
      deviceId: store.state.deviceId,
    });
    for (const event of undoEvents) {
      await store.dispatchLocalEvent(event);
    }
    setLiveChange(null);
  }

  return (
    <Screen edges={[]}>
      <LegendList
        data={messages}
        keyExtractor={(item: ChatMessage) => item.id}
        estimatedItemSize={64}
        style={styles.list}
        contentContainerStyle={{
          paddingHorizontal: theme.space.screenX,
          paddingTop: 12,
          paddingBottom: 12,
          flexGrow: 1,
        }}
        recycleItems
        ListEmptyComponent={
          empty ? (
            <View style={styles.suggestions}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: theme.type.row,
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Ask about your tasks, or try a suggestion.
              </Text>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => void onSend(suggestion)}
                  style={[
                    styles.suggestion,
                    {
                      borderColor: theme.colors.line,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }: { item: ChatMessage }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user"
                ? {
                    alignSelf: "flex-end",
                    backgroundColor: theme.colors.pine,
                    maxWidth: "85%",
                  }
                : {
                    alignSelf: "stretch",
                    backgroundColor: "transparent",
                    maxWidth: "100%",
                    paddingHorizontal: 0,
                  },
            ]}
          >
            {item.role === "user" ? (
              <Text style={{ color: theme.colors.onPine, fontSize: theme.type.row }}>
                {item.text}
              </Text>
            ) : (
              <MessageWithRefs text={item.text} />
            )}
          </View>
        )}
      />

      {streaming ? (
        <View style={{ paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
          <MessageWithRefs text={streaming} />
        </View>
      ) : null}
      {liveChange ? (
        <View style={{ paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
          <ChangeCard
            summary={summarizeChangeEvents(liveChange.events, [
              { label: liveChange.summaryLabel },
            ])}
            onUndo={() => void onUndo()}
          />
        </View>
      ) : null}
      {error ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.type.meta,
            paddingHorizontal: theme.space.screenX,
            marginBottom: 8,
          }}
        >
          {error}
        </Text>
      ) : null}

      <Composer
        value={draft}
        onChangeText={setDraft}
        placeholder="Message…"
        onSend={() => void onSend()}
        onMic={() => void onMicHold()}
        busy={busy}
        onStop={() => void onStop()}
        autoFocus={isNew}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { flex: 1 },
  bubble: {
    marginBottom: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestions: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 40,
    gap: 10,
  },
  suggestion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
});
