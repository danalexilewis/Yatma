import {
  assistantMessageId,
  reconcileThreadMessages,
  pageThreadMessages,
  selectThreadMessages,
  threadMessageKey,
  type ChatId,
  type FoldedEntities,
  type ThreadMessage,
  type ThreadMessageWindow,
} from "@yatma/core";
import { useRef, useState } from "react";

import { flattenThreadMessages } from "./messageParts";

export type ActiveThreadTurn = {
  readonly chatId: ChatId;
  readonly turnId: string;
  readonly text: string;
  readonly at: string;
};

/** Bounded presentation over hydrated messages; entity edits never change message membership. */
export function useThreadTimeline(folded: FoldedEntities, active?: ActiveThreadTurn) {
  const [selection, setSelection] = useState<ThreadMessageWindow | null>(null);
  const anchor = useRef<string | undefined>(undefined);
  const nearBottom = useRef(true);
  const messages = reconcileThreadMessages(
    selectThreadMessages(folded),
    active?.text
      ? {
          chatId: active.chatId,
          message: {
            id: assistantMessageId(active.turnId),
            role: "assistant",
            text: active.text,
            at: active.at,
          },
        }
      : undefined,
  );
  const selectedKeys = selection ? new Set(selection.messages.map(threadMessageKey)) : null;
  const retained = selectedKeys
    ? messages.filter((entry) => selectedKeys.has(threadMessageKey(entry)))
    : [];
  const current =
    !selection || nearBottom.current
      ? pageThreadMessages(messages, [], "latest")
      : {
          messages: retained,
          hasOlder:
            retained.length > 0 &&
            threadMessageKey(messages[0]!) !== threadMessageKey(retained[0]!),
          hasNewer:
            retained.length > 0 &&
            threadMessageKey(messages.at(-1)!) !== threadMessageKey(retained.at(-1)!),
        };
  function reportViewport(messageKey: string | undefined, atBottom: boolean) {
    anchor.current = messageKey;
    if (nearBottom.current && !atBottom) setSelection(current);
    nearBottom.current = atBottom && !current.hasNewer;
  }
  function page(direction: "older" | "newer") {
    nearBottom.current = false;
    setSelection(pageThreadMessages(messages, current.messages, direction, anchor.current));
  }
  function jumpToLatest() {
    nearBottom.current = true;
    setSelection(null);
  }
  return {
    ...current,
    rows: flattenThreadMessages(current.messages),
    pageOlder: () => page("older"),
    pageNewer: () => page("newer"),
    reportViewport,
    jumpToLatest,
    followingLatest: nearBottom.current && !current.hasNewer,
  };
}
