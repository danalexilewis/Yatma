import type { ChatStreamItem, Event } from "@yatma/core";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ChangeCard } from "../chat/ChangeCard";
import { summarizeChangeEvents } from "../chat/changeSummary";
import { eventsFromUndoPlan } from "../chat/undoBatch";
import { dictateFromMic } from "../dictation";
import { useAppStore } from "../../state/atoms";
import { sendChatTurn } from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { colors } from "../../theme/colors";

type CaptureSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSend?: (text: string) => void;
};

type LiveChange = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly summaryLabel: string;
};

/** Compact global-chat capture opened from the Now mic. */
export function CaptureSheet(props: CaptureSheetProps) {
  const { visible, onClose, onSend } = props;
  const store = useAppStore();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onMic() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const engine = getSyncEngine();
    const result = await dictateFromMic({
      callRpc: engine ? (method, payload) => engine.client.callRpc(method, payload) : undefined,
    });
    if (result.text) setDraft((prev) => (prev ? `${prev} ${result.text}` : result.text));
  }

  async function onSubmit() {
    const text = draft.trim();
    if (!text || busy) return;
    onSend?.(text);
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-white p-4 dark:bg-slate-950">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Capture
            </Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: colors.brand }}>Close</Text>
            </Pressable>
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add X, move Y to the top, finish Z…"
            placeholderTextColor={colors.muted}
            multiline
            className="min-h-24 rounded-2xl border border-slate-200 px-3 py-2 text-base text-slate-900 dark:border-slate-700 dark:text-slate-50"
          />
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => void onMic()}
              className="rounded-full px-4 py-2"
              style={{ backgroundColor: colors.brandMuted }}
            >
              <Text className="font-medium text-white">Mic</Text>
            </Pressable>
            <Pressable
              onPress={() => void onSubmit()}
              className="rounded-full px-4 py-2"
              style={{ backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}
            >
              <Text className="font-medium text-white">{busy ? "…" : "Send"}</Text>
            </Pressable>
          </View>
          {streaming ? (
            <Text className="mt-3 text-sm text-slate-600 dark:text-slate-300">{streaming}</Text>
          ) : null}
          {error ? <Text className="mt-2 text-sm text-red-600">{error}</Text> : null}
          {liveChange ? (
            <View className="mt-4">
              <ChangeCard
                summary={summarizeChangeEvents(liveChange.events, [
                  { label: liveChange.summaryLabel },
                ])}
                onUndo={() => void onUndo()}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
