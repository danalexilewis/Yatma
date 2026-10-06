// Copyright (c) T3 Tools / MIT — adapted for Yatma
import {
  type Event,
  BatchId as BatchIdSchema,
  ChatId as ChatIdSchema,
  generateEventId,
  generateShortId,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as OpenRouter from "./agent/openrouter.ts";
import * as Tools from "./agent/tools.ts";
import * as EventStore from "./eventStore.ts";

/** Idle minutes before UserSpace schedules a curator wrap-up alarm. */
export const CURATOR_IDLE_MINUTES = 30;

export type WrapUpTrigger = "user" | "idle_alarm";

export type WrapUpPlan = {
  readonly chatId: string;
  readonly trigger: WrapUpTrigger;
  /**
   * Cheap model prompt intent for the curator turn.
   * The DO runs one OpenRouter call, then applies title/summary/brief/page events
   * as a single undoable batch ("Handbook updated").
   */
  readonly goals: readonly [
    "update_chat_title_and_summary",
    "refresh_brief_if_needed",
    "refresh_handbook_pages_if_needed",
  ];
};

export type IdleAlarmPlan = {
  /** Absolute epoch ms when the DO alarm should fire. */
  readonly alarmAtMs: number;
  readonly idleMinutes: number;
};

export type WrapUpResult = {
  readonly batchId: string;
  readonly events: readonly Event[];
  readonly title: string | null;
  readonly summary: string | null;
};

/**
 * Plan a curator wrap-up for a chat.
 * Pure: no DO I/O — the Durable Object runs the model + event writes.
 */
export function wrapUp(input: {
  readonly chatId: string;
  readonly trigger: WrapUpTrigger;
}): WrapUpPlan {
  return {
    chatId: input.chatId,
    trigger: input.trigger,
    goals: [
      "update_chat_title_and_summary",
      "refresh_brief_if_needed",
      "refresh_handbook_pages_if_needed",
    ],
  };
}

/**
 * Schedule (or reschedule) the idle curator alarm from the last activity time.
 * Pure helper: UserSpace schedules via Alchemy.makeCallback / storage.setAlarm.
 */
export function scheduleIdleAlarm(input: {
  readonly lastActivityAtMs: number;
  readonly idleMinutes?: number;
  readonly nowMs?: number;
}): IdleAlarmPlan {
  const idleMinutes = input.idleMinutes ?? CURATOR_IDLE_MINUTES;
  const alarmAtMs = input.lastActivityAtMs + idleMinutes * 60_000;
  return { alarmAtMs, idleMinutes };
}

/**
 * True when an alarm firing should run wrap-up (still idle; not superseded).
 */
export function shouldRunIdleWrapUp(input: {
  readonly alarmAtMs: number;
  readonly lastActivityAtMs: number;
  readonly nowMs: number;
  readonly idleMinutes?: number;
}): boolean {
  const idleMinutes = input.idleMinutes ?? CURATOR_IDLE_MINUTES;
  const expected = input.lastActivityAtMs + idleMinutes * 60_000;
  if (expected > input.alarmAtMs) return false;
  return input.nowMs >= input.alarmAtMs;
}

type CuratorJson = {
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly brief?: { readonly title: string; readonly body: string } | null;
};

function parseCuratorJson(text: string): CuratorJson {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      title: text.trim().slice(0, 80) || null,
      summary: text.trim().slice(0, 280) || null,
      brief: null,
    };
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as CuratorJson;
  } catch {
    return {
      title: "Chat",
      summary: text.trim().slice(0, 280) || null,
      brief: null,
    };
  }
}

/**
 * Execute a wrap-up: cheap model call → chat.updated (+ optional brief) as one batch.
 */
export function executeWrapUp(input: {
  readonly chatId: string;
  readonly trigger: WrapUpTrigger;
  readonly model: string;
  readonly openRouterKey: string | null;
}) {
  return Effect.gen(function* () {
    const plan = wrapUp({ chatId: input.chatId, trigger: input.trigger });
    const chatId = ChatIdSchema.make(input.chatId);
    const nowIso = new Date().toISOString();
    const batchId = Tools.newBatchId();
    const actor = { kind: "agent" as const, chatId, model: input.model };

    const folded = yield* EventStore.loadFolded;
    const chat = folded.chats.get(chatId);
    if (!chat) {
      return {
        batchId,
        events: [] as Event[],
        title: null,
        summary: null,
      } satisfies WrapUpResult;
    }

    const recent = chat.messages
      .slice(-20)
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n");

    let parsed: CuratorJson = {
      title: chat.title ?? "Chat",
      summary: chat.summary ?? `Wrapped up (${plan.trigger}).`,
      brief: null,
    };

    if (input.openRouterKey) {
      const completion = yield* OpenRouter.completeCurator(
        { apiKey: Redacted.make(input.openRouterKey), model: input.model },
        [
          {
            role: "system",
            content:
              'Return JSON only: {"title":string|null,"summary":string|null,"brief":{"title":string,"body":string}|null}. Keep title short; summary ≤ 280 chars.',
          },
          {
            role: "user",
            content: `Chat title: ${chat.title ?? "(none)"}\nSummary: ${chat.summary ?? "(none)"}\n\nMessages:\n${recent}`,
          },
        ],
      ).pipe(
        Effect.map(Option.some),
        Effect.catch(() => Effect.succeed(Option.none())),
      );
      if (Option.isSome(completion)) {
        parsed = parseCuratorJson(completion.value.text);
      }
    }

    const pending: Event[] = [];
    const title = parsed.title ?? chat.title;
    const summary = parsed.summary ?? chat.summary;
    const set: { title?: string | null; summary?: string | null } = {};
    const prev: { title?: string | null; summary?: string | null } = {};
    if (title !== chat.title) {
      set.title = title;
      prev.title = chat.title;
    }
    if (summary !== chat.summary) {
      set.summary = summary;
      prev.summary = chat.summary;
    }
    if (Object.keys(set).length > 0) {
      pending.push({
        v: 1,
        type: "chat.updated",
        id: generateEventId(),
        at: nowIso,
        by: actor,
        reason: "Handbook updated",
        batch: BatchIdSchema.make(batchId),
        chatId,
        set,
        prev,
      });
    }

    if (pending.length > 0) {
      yield* EventStore.pushEvents(pending, nowIso);
    }

    if (parsed.brief) {
      const existingBrief = [...folded.pages.values()].find(
        (page) =>
          page.kind === "brief" &&
          page.deletedAt === null &&
          page.projectId === chat.projectId,
      );
      const briefInput: Tools.WritePageInput = existingBrief
        ? {
            pageId: existingBrief.id,
            projectId: chat.projectId,
            kind: "brief",
            title: parsed.brief.title,
            body: parsed.brief.body,
            reason: "Handbook updated",
          }
        : {
            projectId: chat.projectId,
            kind: "brief",
            title: parsed.brief.title,
            body: parsed.brief.body,
            reason: "Handbook updated",
          };
      yield* Tools.writePage(briefInput, {
        actor,
        batchId: BatchIdSchema.make(batchId),
        nowIso,
      });
    }

    const batchEvents = yield* EventStore.eventsForBatch(batchId);
    return {
      batchId,
      events: batchEvents,
      title: title ?? null,
      summary: summary ?? null,
    } satisfies WrapUpResult;
  });
}

/** Stable id used with Alchemy.makeCallback for idle wrap-up. */
export const IDLE_WRAPUP_CALLBACK = "curator_idle";

export function idleCallbackId(chatId: string): string {
  return `idle_${chatId}`;
}

export function newMessageId(): string {
  return `msg_${generateShortId("t_").slice(2)}`;
}
