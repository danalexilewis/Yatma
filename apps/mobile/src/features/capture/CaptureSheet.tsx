import type { ChatStreamItem, Event } from "@yatma/core";
import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ChangeCard } from "../chat/ChangeCard";
import { summarizeChangeEvents } from "../chat/changeSummary";
import { eventsFromUndoPlan } from "../chat/undoBatch";
import { dictateFromMic } from "../dictation";
import { useAppStore } from "../../state/atoms";
import { sendChatTurn } from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { Composer, IconButton } from "../../ui";

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

/** Bottom-anchored capture sheet opened from the Now mic. */
export function CaptureSheet(props: CaptureSheetProps) {
  const { visible, onClose, onSend } = props;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
      <View style={styles.modalRoot}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
        <View style={[styles.grabber, { backgroundColor: theme.colors.line }]} />
        <View style={styles.header}>
          <Text
            style={{
              color: theme.colors.ink,
              fontSize: 18,
              fontWeight: "700",
            }}
          >
            Capture
          </Text>
          <IconButton
            name="close"
            accessibilityLabel="Close"
            color={theme.colors.muted}
            onPress={onClose}
          />
        </View>
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: theme.type.meta,
            paddingHorizontal: theme.space.screenX,
            marginBottom: 8,
          }}
        >
          Add X, move Y to the top, finish Z…
        </Text>
        {streaming ? (
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.type.meta,
              paddingHorizontal: theme.space.screenX,
              marginBottom: 8,
            }}
          >
            {streaming}
          </Text>
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
          <Composer
            value={draft}
            onChangeText={setDraft}
            placeholder="Dictate or type a change…"
            onSend={() => void onSubmit()}
            onMic={() => void onMic()}
            busy={busy}
            autoFocus
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingLeft: 16,
  },
});
