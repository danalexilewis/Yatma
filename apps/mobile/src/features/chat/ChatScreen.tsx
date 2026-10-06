import { LegendList } from "@legendapp/list/react-native";
import type { ChatStreamItem, Event } from "@yatma/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ChangeCard } from "./ChangeCard";
import { summarizeChangeEvents } from "./changeSummary";
import { MessageWithRefs } from "./RefUnfurl";
import { eventsFromUndoPlan } from "./undoBatch";
import { dictateFromMic } from "../dictation";
import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectChats } from "../../state/selectors";
import { sendChatTurn } from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { colors } from "../../theme/colors";

type ListItem =
  | { readonly kind: "chat"; readonly id: string; readonly title: string; readonly summary: string }
  | { readonly kind: "empty" };

type LiveChange = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly summaryLabel: string;
};

/** Global chat list + composer. */
export function ChatScreen() {
  const router = useRouter();
  const folded = useFoldedState();
  const store = useAppStore();
  const chats = selectChats(folded);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);

  const data: ListItem[] =
    chats.length === 0
      ? [{ kind: "empty" }]
      : chats.map((chat) => ({
          kind: "chat" as const,
          id: chat.id,
          title: chat.title ?? "Untitled chat",
          summary: chat.summary ?? chat.messages.at(-1)?.text ?? "No messages yet",
        }));

  async function onMicHold() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const engine = getSyncEngine();
    const result = await dictateFromMic({
      callRpc: engine ? (method, payload) => engine.client.callRpc(method, payload) : undefined,
    });
    if (result.text) setDraft((prev) => (prev ? `${prev} ${result.text}` : result.text));
  }

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
        projectId: null,
        text,
        handlers: {
          onItem: (item: ChatStreamItem) => {
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
            if (item.kind === "started" && item.chatId) {
              // Open the new thread once created.
              router.push(`/chat/${item.chatId}`);
            }
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
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-50">Chat</Text>
        <Text className="text-sm text-slate-500">Previous chats</Text>
      </View>

      <LegendList
        data={data}
        keyExtractor={(item: ListItem) => (item.kind === "empty" ? "empty" : item.id)}
        estimatedItemSize={72}
        className="flex-1 px-4"
        recycleItems
        renderItem={({ item }: { item: ListItem }) => {
          if (item.kind === "empty") {
            return (
              <Text className="mt-10 text-center text-slate-500">
                Start a conversation. Hold mic to dictate.
              </Text>
            );
          }
          return (
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              className="mb-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <Text className="text-base font-medium text-slate-900 dark:text-slate-50">
                {item.title}
              </Text>
              <View className="mt-1">
                <MessageWithRefs text={item.summary} />
              </View>
            </Pressable>
          );
        }}
      />

      {streaming ? (
        <View className="mx-4 mb-2 rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-900">
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
        <Pressable
          onLongPress={() => void onMicHold()}
          className="rounded-full px-3 py-2"
          style={{ backgroundColor: colors.brandMuted }}
        >
          <Text className="text-white">Mic</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about tasks…"
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
