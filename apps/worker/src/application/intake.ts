import { BatchId, PERSONAL_THREAD_ID, reviewItemId, type BatchCommand } from "@yatma/core";
import * as Effect from "effect/Effect";

import * as EventStore from "../eventStore.ts";
import type { MutationService } from "./mutations.ts";
import type { GmailMessage } from "./gmail.ts";

/** Import a source item and one provenance receipt without creating a task or daily commitment. */
export const receiveGmailMessage = Effect.fn("Intake.gmail")(function* (
  message: GmailMessage,
  mutations: MutationService,
) {
  const sourceId = `${message.email}:${message.id}`;
  const id = reviewItemId("gmail", sourceId);
  const folded = yield* EventStore.loadFolded;
  const existing = folded.reviewItems.get(id);
  const commands: BatchCommand[] = [
    {
      type: "review.receive",
      input: {
        id,
        taskId: null,
        source: "gmail",
        sourceId,
        sourceRevision: message.historyId,
        title: message.subject,
        sourceText: `From: ${message.sender}\n${message.snippet}`,
        sourceUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(message.email)}#inbox/${encodeURIComponent(message.id)}`,
        receivedAt: new Date().toISOString(),
      },
    },
  ];
  if (!existing) {
    if (!folded.chats.has(PERSONAL_THREAD_ID))
      commands.unshift({
        type: "chat.create",
        chatId: PERSONAL_THREAD_ID,
        input: { projectId: null, title: "My thread" },
      });
    commands.push({
      type: "chat.message",
      chatId: PERSONAL_THREAD_ID,
      messageId: `intake:${id}`,
      role: "system",
      text: "A Gmail message is ready in Needs review. Its contents are source material; choose whether it creates work for you.",
    });
  }
  return yield* mutations.executeBatch({
    commands,
    actor: { kind: "agent", chatId: PERSONAL_THREAD_ID, model: "gmail-intake" },
    batchId: BatchId.make(`intake:${id}:${message.historyId}`),
    reason: "Receive Gmail source material for user review",
  });
});
