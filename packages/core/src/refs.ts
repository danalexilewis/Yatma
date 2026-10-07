// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ChatId, PageId, TaskId } from "./ids.ts";
import { ChatId as ChatIdSchema, PageId as PageIdSchema, TaskId as TaskIdSchema } from "./ids.ts";

export type RefKind = "task" | "page" | "chat";

export type EntityRef =
  | { readonly kind: "task"; readonly id: TaskId; readonly label: string }
  | { readonly kind: "page"; readonly id: PageId; readonly label: string }
  | { readonly kind: "chat"; readonly id: ChatId; readonly label: string };

export type ParsedRef =
  | { readonly ok: true; readonly ref: EntityRef }
  | { readonly ok: false; readonly raw: string; readonly reason: "unknown_scheme" | "invalid_id" };

/** Markdown link target: `task:t_…`, `page:pg_…`, or `chat:c_…`. */
const REF_HREF = /^(task|page|chat):(.+)$/;

/** Inline markdown links: `[label](task:t_x)`. */
const MARKDOWN_LINK = /\[([^\]]*)\]\((task|page|chat):([^)\s]+)\)/g;

const decodeTaskId = Schema.decodeUnknownOption(TaskIdSchema);
const decodePageId = Schema.decodeUnknownOption(PageIdSchema);
const decodeChatId = Schema.decodeUnknownOption(ChatIdSchema);

/**
 * Parse a single ref href (`task:t_…`). Unknown ids fail closed so invented
 * model ids render as plain text in the UI.
 */
export function parseRefHref(href: string, label: string = ""): ParsedRef {
  const match = REF_HREF.exec(href.trim());
  if (!match) return { ok: false, raw: href, reason: "unknown_scheme" };
  const kind = match[1] as RefKind;
  const idPart = match[2] ?? "";
  if (kind === "task") {
    const id = decodeTaskId(idPart);
    if (Option.isNone(id)) return { ok: false, raw: href, reason: "invalid_id" };
    return { ok: true, ref: { kind: "task", id: id.value, label } };
  }
  if (kind === "page") {
    const id = decodePageId(idPart);
    if (Option.isNone(id)) return { ok: false, raw: href, reason: "invalid_id" };
    return { ok: true, ref: { kind: "page", id: id.value, label } };
  }
  const id = decodeChatId(idPart);
  if (Option.isNone(id)) return { ok: false, raw: href, reason: "invalid_id" };
  return { ok: true, ref: { kind: "chat", id: id.value, label } };
}

/** Extract all valid entity refs from assistant markdown. */
export function extractRefs(text: string): EntityRef[] {
  const found: EntityRef[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const label = match[1] ?? "";
    const kind = match[2] ?? "";
    const id = match[3] ?? "";
    const parsed = parseRefHref(`${kind}:${id}`, label);
    if (parsed.ok) found.push(parsed.ref);
  }
  return found;
}

/**
 * Classify how a ref should unfurl in chat.
 * - Own line → card; consecutive task lines → list; otherwise chip.
 */
export function classifyRefPlacement(
  text: string,
  lineIndex: number,
): "chip" | "card" | "list_item" {
  const lines = text.split("\n");
  const line = (lines[lineIndex] ?? "").trim();
  const onlyLink = /^\[([^\]]*)\]\((task|page|chat):([^)\s]+)\)$/.test(line);
  if (!onlyLink) return "chip";
  const prev = (lines[lineIndex - 1] ?? "").trim();
  const next = (lines[lineIndex + 1] ?? "").trim();
  const isTaskLine = /^\[[^\]]*\]\(task:[^)\s]+\)$/.test(line);
  const prevTask = /^\[[^\]]*\]\(task:[^)\s]+\)$/.test(prev);
  const nextTask = /^\[[^\]]*\]\(task:[^)\s]+\)$/.test(next);
  if (isTaskLine && (prevTask || nextTask)) return "list_item";
  return "card";
}

/** Format a live ref link the model can emit. */
export function formatRef(kind: RefKind, id: string, label: string): string {
  return `[${label}](${kind}:${id})`;
}
