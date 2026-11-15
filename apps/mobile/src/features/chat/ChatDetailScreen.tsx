import type { BatchCommand, ChatStreamItem, Event } from "@yatma/core";
import { assistantMessageId, formatRef, generateShortId, PERSONAL_THREAD_ID } from "@yatma/core";
import { useGlobalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ReviewPanel } from "./ReviewPanel";
import { ChangeCard } from "./ChangeCard";
import { summarizeChangeEvents } from "./changeSummary";
import { TaskThread } from "./TaskThread";
import { ThreadComposer } from "./ThreadComposer";
import { CaptureSheet } from "../capture/CaptureSheet";
import { consumeCaptureOpen, subscribeCaptureOpen } from "../capture/captureIntent";
import { useDictation } from "../dictation";
import { getAutoSendDictation } from "../settings/autoSendPreference";
import { useAppStore } from "../../state/atoms";
import {
  findActiveChatTurn,
  resumeChatTurn,
  sendChatTurn,
  stopChatTurn,
  wrapUpChat,
} from "../../sync/chatClient";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { Screen, ScreenHeader } from "../../ui";
import { UndoReasonDialog } from "../../ui/UndoReasonDialog";

type LiveChange = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly summaryLabel: string;
};

/** The permanent conversation keeps its original replies and live task references. */
export function ChatDetailScreen() {
  const {
    taskId,
    pageId,
    projectId: discussedProjectId,
  } = useGlobalSearchParams<{ taskId?: string; pageId?: string; projectId?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const store = useAppStore();
  const dictation = useDictation();
  const [draft, setDraft] = useState("");
  const [followRequest, setFollowRequest] = useState(0);
  const [streamTurnId, setStreamTurnId] = useState<string | null>(null);
  const [streamAt, setStreamAt] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const composerSubmit = useRef<((text: string) => Promise<void>) | null>(null);
  const observedTurnIds = useRef(new Set<string>());
  const chat = store.state.folded.chats.get(PERSONAL_THREAD_ID);
  const accountRef = useRef(store.state.accountId);
  accountRef.current = store.state.accountId;

  useEffect(() => {
    setStreaming("");
    setStreamTurnId(null);
    setLiveChange(null);
    setBusy(false);
    setTurnId(null);
    setDraft("");
    setError(null);
  }, [store.state.accountId]);

  useEffect(() => {
    function openIfPending() {
      if (consumeCaptureOpen()) setCaptureOpen(true);
    }
    openIfPending();
    return subscribeCaptureOpen(openIfPending);
  }, []);

  useEffect(() => {
    if (!store.state.ready || (!taskId && !pageId && !discussedProjectId)) return;
    const task = [...store.state.folded.tasks.values()].find((item) => item.id === taskId);
    const page = [...store.state.folded.pages.values()].find((item) => item.id === pageId);
    const discussedProject = [...store.state.folded.projects.values()].find(
      (item) => item.id === discussedProjectId,
    );
    if (task) setDraft(`About ${formatRef("task", task.id, task.title)}: `);
    else if (page) setDraft(`About ${formatRef("page", page.id, page.title)}: `);
    else if (discussedProject)
      setDraft(`About ${formatRef("project", discussedProject.id, discussedProject.title)}: `);
    else return;
    router.setParams({ taskId: undefined, pageId: undefined, projectId: undefined });
  }, [taskId, pageId, discussedProjectId, store.state.ready]);

  function applyTurnItem(item: ChatStreamItem) {
    if (item.kind === "started") {
      observedTurnIds.current.add(item.turnId);
      setTurnId(item.turnId);
      setStreamTurnId(item.turnId);
      setStreamAt(new Date().toISOString());
    }
    if (item.kind === "text_delta") setStreaming((prev) => prev + item.text);
    if (item.kind === "changes") {
      void store
        .mergeRemoteEvents(item.events)
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not save the changes."),
        );
      setLiveChange({ batchId: item.batchId, events: item.events, summaryLabel: item.summary });
    }
    if (item.kind === "done") {
      setTurnId(null);
    }
  }

  useEffect(() => {
    if (
      streamTurnId &&
      chat?.messages.some((message) => message.id === assistantMessageId(streamTurnId))
    ) {
      setStreaming("");
      setStreamTurnId(null);
    }
  }, [chat?.messages, streamTurnId]);

  useEffect(() => {
    if (!store.state.ready) return;
    let current = true;
    observedTurnIds.current.clear();
    async function recover() {
      try {
        const activeTurnId = await findActiveChatTurn(PERSONAL_THREAD_ID);
        if (!current || !activeTurnId || observedTurnIds.current.has(activeTurnId)) return;
        setBusy(true);
        setError(null);
        setStreaming("");
        setLiveChange(null);
        await resumeChatTurn({
          chatId: PERSONAL_THREAD_ID,
          handlers: {
            onItem: (item) => {
              if (current) applyTurnItem(item);
            },
            onError: (cause) => {
              if (current) setError(cause instanceof Error ? cause.message : String(cause));
            },
          },
        });
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (current) {
          setBusy(false);
          setTurnId(null);
        }
      }
    }
    void recover();
    return () => {
      current = false;
    };
  }, [store.state.ready, store.state.accountId]);

  async function onWrapUp() {
    setBusy(true);
    setError(null);
    try {
      const result = await wrapUpChat(PERSONAL_THREAD_ID);
      if (result?.events?.length) {
        await store.mergeRemoteEvents(result.events);
        setLiveChange({
          batchId: result.batchId,
          events: result.events,
          summaryLabel: "Handbook updated",
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onMic() {
    if (busy || dictation.transcribing) return;
    dictation.clearError();
    setError(null);
    try {
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
      if (autoSend && composerSubmit.current) await composerSubmit.current(result.text);
      else setDraft((prev) => (prev ? `${prev} ${result.text}` : result.text));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dictation failed. Try again.");
    }
  }

  async function onSend(text: string) {
    if (busy) return;
    const accountId = store.state.accountId;
    const messageId = generateShortId("c_");
    const commands: BatchCommand[] = [];
    if (!chat)
      commands.push({
        type: "chat.create",
        chatId: PERSONAL_THREAD_ID,
        input: { projectId: null, title: "My thread" },
      });
    commands.push({
      type: "chat.message",
      chatId: PERSONAL_THREAD_ID,
      messageId,
      role: "user",
      text,
    });
    // Save the message before clearing the composer or starting network work.
    await store.executeLocalCommands(commands);
    if (accountRef.current !== accountId) return;
    setFollowRequest((request) => request + 1);
    setDraft((current) => (current.trim() === text ? "" : current));
    setBusy(true);
    setError(null);
    setStreaming("");
    setLiveChange(null);
    if (!getSyncEngine()) {
      setError("Message saved. Connect to chat with Yatma.");
      setBusy(false);
      return;
    }
    try {
      await sendChatTurn({
        chatId: PERSONAL_THREAD_ID,
        projectId: null,
        messageId,
        text,
        handlers: {
          onItem: (item) => {
            if (accountRef.current === accountId) applyTurnItem(item);
          },
        },
      });
    } catch (cause) {
      if (accountRef.current !== accountId) return;
      setError(
        `Message saved. ${cause instanceof Error ? cause.message : "Could not reach Yatma. Try again when connected."}`,
      );
    } finally {
      if (accountRef.current === accountId) setBusy(false);
    }
  }

  async function onStop() {
    try {
      await stopChatTurn({ chatId: PERSONAL_THREAD_ID, turnId: turnId ?? undefined });
      setBusy(false);
      setTurnId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop this turn.");
    }
  }

  async function onUndo(reason: string) {
    if (!liveChange) return;
    try {
      const result = await store.undoBatch(liveChange.batchId, liveChange.events, reason);
      setLiveChange(null);
      setUndoDialogOpen(false);
      if (result.skipped.length)
        setError(`${result.skipped.length} changes were preserved because they changed later.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ScreenHeader
          title="Plan with Yatma"
          trailing={
            <>
              {chat ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Wrap up conversation"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void onWrapUp()}
                  style={[
                    styles.wrapUp,
                    { backgroundColor: theme.colors.pine, opacity: busy ? 0.5 : 1 },
                  ]}
                >
                  <Text style={{ color: theme.colors.onPine, fontSize: 14, fontWeight: "700" }}>
                    Wrap up
                  </Text>
                </Pressable>
              ) : null}
            </>
          }
        />
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: theme.type.meta,
            lineHeight: 20,
            paddingHorizontal: theme.space.screenX,
            paddingBottom: 10,
          }}
        >
          Gather context and shape your plan for Today. Type /list for your backlog, or mention
          @task and @project.
        </Text>
        <ReviewPanel
          key={store.state.accountId ?? "offline"}
          busy={busy}
          onDiscuss={(text) =>
            setDraft((current) =>
              current.trim()
                ? `${current}

${text}`
                : text,
            )
          }
        />
      </View>
      <TaskThread
        key={store.state.accountId ?? "offline"}
        followRequest={followRequest}
        busy={busy}
        activeTurn={
          streamTurnId
            ? { chatId: PERSONAL_THREAD_ID, turnId: streamTurnId, text: streaming, at: streamAt }
            : undefined
        }
        footer={
          liveChange ? (
            <View style={styles.progress}>
              <ChangeCard
                summary={summarizeChangeEvents(liveChange.events, [
                  { label: liveChange.summaryLabel },
                ])}
                onUndo={() => setUndoDialogOpen(true)}
              />
            </View>
          ) : null
        }
      />
      <View style={styles.status}>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.danger, fontSize: theme.type.meta }}
          >
            {error}
          </Text>
        ) : null}
        {dictation.error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.danger, fontSize: theme.type.meta }}
          >
            {dictation.error}
          </Text>
        ) : null}
        {dictation.recording ? (
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta }}>
            Recording {Math.floor(dictation.durationMillis / 1000)}s. Tap the microphone to stop.
          </Text>
        ) : null}
        {dictation.transcribing ? (
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
            Transcribing recording…
          </Text>
        ) : null}
      </View>
      <ThreadComposer
        value={draft}
        onChangeText={setDraft}
        onMessage={onSend}
        onLocalReply={() => setFollowRequest((request) => request + 1)}
        onMic={() => void onMic()}
        busy={busy}
        onStop={() => void onStop()}
        tabBarPad
        submitRef={composerSubmit}
      />
      <CaptureSheet
        visible={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSend={() => {
          setCaptureOpen(false);
        }}
      />
      <UndoReasonDialog
        visible={undoDialogOpen}
        onCancel={() => setUndoDialogOpen(false)}
        onSubmit={onUndo}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { width: "100%", maxWidth: 760, alignSelf: "center" },
  wrapUp: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    borderRadius: 24,
  },
  status: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 16, gap: 6 },
  progress: { paddingVertical: 12 },
});
