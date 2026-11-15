import { parseRefHref, type EntityRef, type ThreadMessage } from "@yatma/core";

export type InlinePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "ref"; readonly ref: EntityRef };
export type MessagePart =
  | { readonly kind: "line"; readonly index: number; readonly parts: readonly InlinePart[] }
  | {
      readonly kind: "task";
      readonly index: number;
      readonly taskId: string;
      readonly label: string;
      readonly commentary: string;
      readonly prefix: string;
    };
export type TimelineRow =
  | { readonly kind: "heading"; readonly key: string; readonly entry: ThreadMessage }
  | {
      readonly kind: "part";
      readonly key: string;
      readonly entry: ThreadMessage;
      readonly part: MessagePart;
    };

const LINK = /\[((?:\\.|[^\]\\])*)\]\((task|project|page|chat):([^\s)]+)\)/g;
const TASK_LINE =
  /^(\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)\[((?:\\.|[^\]\\])*)\]\(task:([^\s)]+)\)(?:\s*[—–-]\s*(.*))?\s*$/;

/** Preserves source order, repeated refs, numbering, commentary, invalid IDs and partial streams. */
export function parseMessageParts(text: string): MessagePart[] {
  return text.split("\n").map((line, index) => {
    const task = TASK_LINE.exec(line);
    const parsed = task ? parseRefHref(`task:${task[3]}`, task[2] ?? "") : undefined;
    if (task && parsed?.ok && parsed.ref.kind === "task") {
      return {
        kind: "task",
        index,
        taskId: parsed.ref.id,
        label: parsed.ref.label || parsed.ref.id,
        commentary: task[4] ?? "",
        prefix: task[1] ?? "",
      };
    }
    return { kind: "line", index, parts: parseInlineParts(line) };
  });
}

export function parseInlineParts(line: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const match of line.matchAll(LINK)) {
    const offset = match.index;
    if (offset > cursor) parts.push({ kind: "text", text: line.slice(cursor, offset) });
    const parsed = parseRefHref(`${match[2]}:${match[3]}`, match[1] ?? "");
    parts.push(parsed.ok ? { kind: "ref", ref: parsed.ref } : { kind: "text", text: match[0] });
    cursor = offset + match[0].length;
  }
  if (cursor < line.length || parts.length === 0)
    parts.push({ kind: "text", text: line.slice(cursor) });
  return parts;
}

/** Every task occurrence is a separate list row; keys depend only on message identity and position. */
export function flattenThreadMessages(messages: readonly ThreadMessage[]): TimelineRow[] {
  return messages.flatMap((entry) => [
    {
      kind: "heading" as const,
      key: JSON.stringify([entry.chatId, entry.message.id, "heading"]),
      entry,
    },
    ...parseMessageParts(entry.message.text).map((part) => ({
      kind: "part" as const,
      key: JSON.stringify([entry.chatId, entry.message.id, part.index]),
      entry,
      part,
    })),
  ]);
}
