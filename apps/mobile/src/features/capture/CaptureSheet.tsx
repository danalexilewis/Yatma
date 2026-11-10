import type { ChatStreamItem, Event } from "@yatma/core";
import { useEffect, useRef, useState } from "react";
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
import { useDictation } from "../dictation";
import { getAutoSendDictation } from "../settings/autoSendPreference";
import { useAppStore } from "../../state/atoms";
import { getSyncMeta, setSyncMeta } from "../../db/database";
import { findActiveChatTurn, resumeChatTurn, sendChatTurn, stopChatTurn } from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { Composer, IconButton } from "../../ui";
import { UndoReasonDialog } from "../../ui/UndoReasonDialog";

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

const CAPTURE_CHAT_KEY = "capture.activeChatId";

/** Bottom-anchored capture sheet opened from the Now mic. */
export function CaptureSheet(props: CaptureSheetProps) {
  const { visible, onClose, onSend } = props;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dictation = useDictation();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  const observedTurnIds = useRef(new Set<string>());

  function applyTurnItem(item: ChatStreamItem) {
    if (item.kind === "started") {
      observedTurnIds.current.add(item.turnId);
      setTurnId(item.turnId);
      setActiveChatId(item.chatId);
      void setSyncMeta(CAPTURE_CHAT_KEY, item.chatId).catch((err) => {
        setError(err instanceof Error ? err.message : "Could not save capture recovery state.");
      });
    }
    if (item.kind === "text_delta") setStreaming((prev) => prev + item.text);
    if (item.kind === "changes") {
      void store.mergeRemoteEvents(item.events);
      setLiveChange({ batchId: item.batchId, events: item.events, summaryLabel: item.summary });
    }
    if (item.kind === "done") setTurnId(null);
  }

  useEffect(() => {
    if (!visible) return;
    let current = true;
    async function recover() {
      try {
        const chatId = await getSyncMeta(CAPTURE_CHAT_KEY);
        if (!current || !chatId) return;
        setActiveChatId(chatId);
        const activeTurnId = await findActiveChatTurn(chatId);
        if (!current || !activeTurnId || observedTurnIds.current.has(activeTurnId)) return;
        setBusy(true);
        setError(null);
        setStreaming("");
        setLiveChange(null);
        await resumeChatTurn({
          chatId,
          handlers: {
            onItem: (item) => { if (current) applyTurnItem(item); },
            onError: (err) => { if (current) setError(err instanceof Error ? err.message : String(err)); },
          },
        });
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (current) {
          setBusy(false);
          setTurnId(null);
        }
      }
    }
    void recover();
    return () => { current = false; };
  }, [visible]);

  async function onMic() {
    if (dictation.transcribing || busy) return;
    dictation.clearError();
    setError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const engine = getSyncEngine();
      const result = await dictation.toggle(
        engine ? (method, payload) => engine.client.callRpc(method, payload) : undefined,
      );
      if (!result) return;
      if (!result.text.trim()) {
        setError("No speech was transcribed. Check microphone access and try again.");
        return;
      }
      let autoSend = false;
      try {
        autoSend = await getAutoSendDictation();
      } catch {
        setError("Could not read the auto-send setting. The transcript is available to edit.");
      }
      if (autoSend) {
        await onSubmit(result.text);
      } else {
        setDraft((prev) => (prev ? `${prev} ${result.text}` : result.text));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dictation failed. Try again.");
    }
  }

  async function onSubmit(explicitText?: string) {
    const text = (explicitText ?? draft).trim();
    if (!text || busy) return;
    onSend?.(text);
    if (explicitText === undefined) setDraft("");
    setBusy(true);
    setError(null);
    setStreaming("");
    setLiveChange(null);
    try {
      await sendChatTurn({
        projectId: null,
        text,
        handlers: {
          onItem: applyTurnItem,
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
    try {
      await stopChatTurn({ chatId: activeChatId, turnId: turnId ?? undefined });
      setBusy(false);
      setTurnId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop this turn.");
    }
  }

  async function onUndo(reason: string) {
    if (!liveChange) return;
    try {
      const result = await store.undoBatch(liveChange.batchId, liveChange.events, reason);
      setLiveChange(null);
      setUndoDialogOpen(false);
      if (result.skipped.length > 0) {
        setError(`${result.skipped.length} change${result.skipped.length === 1 ? " was" : "s were"} preserved because they changed later.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function requestClose() {
    if (dictation.recording) {
      try {
        await dictation.cancelRecording();
      } catch {
        setError("Recording could not stop cleanly. Close and reopen capture before recording again.");
        return;
      }
    }
    onClose();
  }

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => void requestClose()}>
      <View style={styles.modalRoot}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={() => void requestClose()}
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
            onPress={() => void requestClose()}
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
        {dictation.error ? (
          <Text style={{ color: theme.colors.danger, fontSize: theme.type.meta, paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
            {dictation.error}
          </Text>
        ) : null}
        {dictation.recording ? (
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta, paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
            Recording · {Math.floor(dictation.durationMillis / 1000)}s · tap the microphone to stop
          </Text>
        ) : null}
        {dictation.transcribing ? (
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
            Transcribing recording…
          </Text>
        ) : null}
        {liveChange ? (
          <View style={{ paddingHorizontal: theme.space.screenX, marginBottom: 8 }}>
            <ChangeCard
              summary={summarizeChangeEvents(liveChange.events, [
                { label: liveChange.summaryLabel },
              ])}
              onUndo={() => setUndoDialogOpen(true)}
            />
          </View>
        ) : null}
          <Composer
            value={draft}
            onChangeText={setDraft}
            placeholder="Dictate or type a change…"
            onSend={() => void onSubmit()}
            onMic={() => void onMic()}
            busy={busy || dictation.transcribing}
            onStop={busy ? () => void onStop() : undefined}
            autoFocus
          />
        </View>
      </View>
    </Modal>
    <UndoReasonDialog
      visible={undoDialogOpen}
      onCancel={() => setUndoDialogOpen(false)}
      onSubmit={onUndo}
    />
    </>
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
