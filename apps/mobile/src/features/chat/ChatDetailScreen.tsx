import { LegendList } from "@legendapp/list/react-native";
import type { ChatMessage, ChatStreamItem, Event } from "@yatma/core";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { ChangeCard } from "./ChangeCard";
import { summarizeChangeEvents } from "./changeSummary";
import { MessageWithRefs } from "./RefUnfurl";
import { eventsFromUndoPlan } from "./undoBatch";
import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectChat } from "../../state/selectors";
import { sendChatTurn, stopChatTurn, wrapUpChat } from "../../sync/chatClient";
import { colors } from "../../theme/colors";

type LiveChange = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly summaryLabel: string;
};

/** Single chat thread with LegendList messages. */
export function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folded = useFoldedState();
  const store = useAppStore();
  const chat = id ? selectChat(folded, id) : undefined;
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);

  if (!chat || !id) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Text className="text-slate-500">Chat not found</Text>
      </View>
    );
  }

  const activeChat = chat;
  const chatId = id;
  const messages: ChatMessage[] = [...activeChat.messages];

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setError(null);
    setStreaming("");
    setLiveChange(null);
    try {
      await sendChatTurn({
        chatId,
        projectId: activeChat.projectId,
        text,
        handlers: {
          onItem: (item: ChatStreamItem) => {
            if (item.kind === "started") setTurnId(item.turnId);
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
    await stopChatTurn({ chatId, turnId: turnId ?? undefined });
    setBusy(false);
    setTurnId(null);
  }

  async function onWrapUp() {
    setBusy(true);
    try {
      const result = await wrapUpChat(chatId);
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
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
        <Text className="flex-1 text-xl font-bold text-slate-900 dark:text-slate-50">
          {activeChat.title ?? "Chat"}
        </Text>
        <Pressable onPress={() => void onWrapUp()} disabled={busy}>
          <Text style={{ color: colors.brand }}>Wrap up</Text>
        </Pressable>
      </View>
      <LegendList
        data={messages}
        keyExtractor={(item: ChatMessage) => item.id}
        estimatedItemSize={64}
        className="flex-1 px-4"
        recycleItems
        renderItem={({ item }: { item: ChatMessage }) => (
          <View
            className="mb-2 max-w-[90%] rounded-2xl px-3 py-2"
            style={{
              alignSelf: item.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: item.role === "user" ? colors.brand : "#E2E8F0",
            }}
          >
            {item.role === "user" ? (
              <Text className="text-base text-white">{item.text}</Text>
            ) : (
              <MessageWithRefs text={item.text} />
            )}
          </View>
        )}
      />
      {streaming ? (
        <View className="mx-4 mb-2 max-w-[90%] self-start rounded-2xl bg-slate-200 px-3 py-2">
          <MessageWithRefs text={streaming} />
        </View>
      ) : null}
      {liveChange ? (
        <View className="mx-4 mb-2">
          <ChangeCard
            summary={summarizeChangeEvents(liveChange.events, [
              { label: liveChange.summaryLabel },
            ])}
            onUndo={() => void onUndo()}
          />
        </View>
      ) : null}
      {error ? (
        <Text className="mx-4 mb-2 text-sm text-red-600">{error}</Text>
      ) : null}
      <View className="flex-row items-end gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
        {busy ? (
          <Pressable onPress={() => void onStop()} className="rounded-full px-3 py-2 bg-slate-300">
            <Text>Stop</Text>
          </Pressable>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor={colors.muted}
          multiline
          className="max-h-28 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        <Pressable
          onPress={() => void onSend()}
          className="rounded-full px-3 py-2"
          style={{ backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}
        >
          <Text className="font-medium text-white">{busy ? "…" : "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
