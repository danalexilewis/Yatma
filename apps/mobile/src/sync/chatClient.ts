import { PERSONAL_THREAD_ID } from "@yatma/core";
import type { ChatStreamItem, ChatWrapUpResult, Event, TurnGetResult, TurnReceipt } from "@yatma/core";

import { getSyncMeta, loadOutboxEvents, setSyncMeta } from "../db/database";
import { getSyncEngine } from "./engine";
import type { SyncClient } from "./client";

export type ChatSendHandlers = {
  readonly onItem: (item: ChatStreamItem) => void;
  readonly onError?: (error: unknown) => void;
};

let generatedId = 0;

function createRequestId(prefix: string): string {
  generatedId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${randomId ?? `${Date.now().toString(36)}_${generatedId.toString(36)}`}`;
}

function activeTurnKey(chatId: string): string {
  return `chat.activeTurn:${chatId}`;
}

function isTerminalStatus(status: TurnReceipt["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "failed" || status === "interrupted";
}

async function clearActiveTurn(chatId: string, turnId: string): Promise<void> {
  const key = activeTurnKey(chatId);
  if ((await getSyncMeta(key)) === turnId) await setSyncMeta(key, "");
}

async function clearWhenTerminal(
  client: SyncClient,
  turnId: string,
  chatId: string,
): Promise<boolean> {
  const result = await client.turnGet({ turnId });
  if (!isTerminalStatus(result.receipt.status)) return false;
  await clearActiveTurn(chatId, turnId);
  return true;
}

/** Start one identified turn, emit its receipt, then observe its durable frames. */
export async function sendChatTurn(input: {
  readonly chatId?: string;
  readonly projectId: string | null;
  readonly text: string;
  readonly requestId?: string;
  readonly messageId?: string;
  readonly handlers: ChatSendHandlers;
}): Promise<TurnReceipt> {
  const engine = getSyncEngine();
  if (!engine) {
    input.handlers.onError?.(new Error("sync not connected"));
    throw new Error("sync not connected");
  }
  const events = await loadOutboxEvents();
  try {
    const receipt = await engine.client.turnStart({
      requestId: input.requestId ?? createRequestId("req"),
      messageId: input.messageId ?? createRequestId("msg"),
      chatId: (input.chatId ?? PERSONAL_THREAD_ID) as never,
      projectId: input.projectId as never,
      text: input.text,
      events,
    });
    await setSyncMeta(activeTurnKey(receipt.chatId), receipt.turnId);
    input.handlers.onItem({ kind: "started", chatId: receipt.chatId, turnId: receipt.turnId });
    const observation = engine.client.turnObserve(
      { turnId: receipt.turnId, after: 1 },
      (frame) => input.handlers.onItem(frame.item),
    );
    await observation.ready;
    await observation.completion;
    await clearWhenTerminal(engine.client, receipt.turnId, receipt.chatId);
    return receipt;
  } catch (error) {
    input.handlers.onError?.(error);
    throw error;
  }
}

export async function stopChatTurn(input: {
  readonly chatId: string;
  readonly turnId?: string;
}): Promise<void> {
  const engine = getSyncEngine();
  if (!engine) return;
  if (input.turnId) {
    await engine.client.turnStop({ turnId: input.turnId });
  } else {
    await engine.client.chatStop(input as never);
  }
}

/** Reattach to stored progress after a socket failure; persist the last observed seq as `after`. */
export function observeChatTurn(input: {
  readonly turnId: string;
  readonly after?: number;
  readonly handlers: ChatSendHandlers;
}): { readonly ready: Promise<void>; readonly completion: Promise<void> } {
  const engine = getSyncEngine();
  if (!engine) throw new Error("sync not connected");
  return engine.client.turnObserve(
    { turnId: input.turnId, after: input.after ?? 0 },
    (frame) => input.handlers.onItem(frame.item),
  );
}

/** Fetch persisted final text, status, and complete mutation batches by stable turn ID. */
export async function getChatTurn(turnId: string): Promise<TurnGetResult | null> {
  const engine = getSyncEngine();
  if (!engine) return null;
  return engine.client.turnGet({ turnId });
}

/** Find the locally retained turn ID for a chat after an interrupted observation. */
export async function findActiveChatTurn(chatId: string): Promise<string | null> {
  const turnId = await getSyncMeta(activeTurnKey(chatId));
  return turnId || null;
}

/** Reattach to the active turn or replay its persisted result and mutation batches if terminal. */
export async function resumeChatTurn(input: {
  readonly chatId: string;
  readonly handlers: ChatSendHandlers;
}): Promise<TurnGetResult | null> {
  const engine = getSyncEngine();
  const turnId = await findActiveChatTurn(input.chatId);
  if (!engine || !turnId) return null;

  const result = await engine.client.turnGet({ turnId });
  if (result.receipt.chatId !== input.chatId) {
    throw new Error("stored turn does not belong to this chat");
  }
  input.handlers.onItem({
    kind: "started",
    chatId: result.receipt.chatId,
    turnId: result.receipt.turnId,
  });

  if (isTerminalStatus(result.receipt.status)) {
    if (result.resultText) input.handlers.onItem({ kind: "text_delta", text: result.resultText });
    for (const batch of result.batches) {
      input.handlers.onItem({
        kind: "changes",
        batchId: batch.batchId,
        events: batch.events,
        summary: batch.summary,
      });
    }
    if (result.error) input.handlers.onError?.(new Error(result.error));
    input.handlers.onItem({ kind: "done", chatId: result.receipt.chatId, turnId });
    await clearActiveTurn(input.chatId, turnId);
    return result;
  }

  const observation = engine.client.turnObserve(
    { turnId, after: 1 },
    (frame) => input.handlers.onItem(frame.item),
  );
  await observation.ready;
  await observation.completion;
  await clearWhenTerminal(engine.client, turnId, input.chatId);
  return result;
}

export async function wrapUpChat(chatId: string): Promise<ChatWrapUpResult | null> {
  const engine = getSyncEngine();
  if (!engine) return null;
  return engine.client.chatWrapUp({ chatId: chatId as never });
}

export type { Event, ChatStreamItem };
