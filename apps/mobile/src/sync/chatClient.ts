import type { ChatStreamItem, ChatWrapUpResult, Event } from "@yatma/core";

import { loadOutboxEvents } from "../db/database";
import { getSyncEngine } from "./engine";

export type ChatSendHandlers = {
  readonly onItem: (item: ChatStreamItem) => void;
  readonly onError?: (error: unknown) => void;
};

/** Send a chat turn with current outbox events via the active sync engine. */
export async function sendChatTurn(input: {
  readonly chatId?: string;
  readonly projectId: string | null;
  readonly text: string;
  readonly handlers: ChatSendHandlers;
}): Promise<void> {
  const engine = getSyncEngine();
  if (!engine) {
    input.handlers.onError?.(new Error("sync not connected"));
    throw new Error("sync not connected");
  }
  const events = await loadOutboxEvents();
  try {
    await engine.client.chatSend(
      {
        chatId: input.chatId as never,
        projectId: input.projectId as never,
        text: input.text,
        events,
      },
      input.handlers.onItem,
    );
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
  await engine.client.chatStop(input as never);
}

export async function wrapUpChat(chatId: string): Promise<ChatWrapUpResult | null> {
  const engine = getSyncEngine();
  if (!engine) return null;
  return engine.client.chatWrapUp({ chatId: chatId as never });
}

export type { Event, ChatStreamItem };
