import type { ReviewSchedule } from "@yatma/contracts/review";
import { BatchId, PERSONAL_THREAD_ID, type BatchCommand } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../eventStore.ts";
import type { MutationService } from "./mutations.ts";

export const REVIEW_CALLBACK = "review.daily";
export const REVIEW_CALLBACK_ID = "review.daily";
export type { ReviewSchedule } from "@yatma/contracts/review";
export type SavedReviewSchedule = ReviewSchedule & { readonly version: string };

export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE IF NOT EXISTS review_schedule (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
  );
});

export const readSchedule = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    payload: string;
  }>`SELECT payload FROM review_schedule WHERE id = 'default'`;
  return rows[0]
    ? (JSON.parse(rows[0].payload) as SavedReviewSchedule)
    : {
        enabled: false,
        localTime: "09:00",
        timezone: "UTC",
        version: "initial",
      };
});

export const saveSchedule = Effect.fn("ReviewSchedule.save")(function* (input: ReviewSchedule) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))
    return yield* Effect.fail({ _tag: "ReviewFailure", message: "Use a time in HH:mm format" });
  const valid = yield* Effect.try({
    try: () => new Intl.DateTimeFormat("en", { timeZone: input.timezone }),
    catch: () => ({ _tag: "ReviewFailure", message: "Use a valid timezone" }),
  });
  void valid;
  const schedule = { ...input, version: crypto.randomUUID() };
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO review_schedule (id, payload) VALUES ('default', ${JSON.stringify(schedule)}) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`;
  return schedule;
});

function localParts(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  function value(type: string) {
    return parts.find((part) => part.type === type)!.value;
  }
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

/** Find a real local occurrence; a skipped DST time runs at the next available minute that day. */
export function nextReviewOccurrence(schedule: ReviewSchedule, now: number): number | null {
  if (!schedule.enabled) return null;
  const today = localParts(now, schedule.timezone);
  const afterToday = today.time >= schedule.localTime;
  const start = Math.floor(now / 60_000) * 60_000 + 60_000;
  for (let at = start; at < start + 72 * 60 * 60_000; at += 60_000) {
    const local = localParts(at, schedule.timezone);
    if (afterToday && local.date === today.date) continue;
    if (local.time >= schedule.localTime) return at;
  }
  return null;
}

/** Re-read current preference and use a day-stable receipt identity across callback retries. */
export const publishDueReview = Effect.fn("ReviewSchedule.publish")(function* (
  version: string,
  now: number,
  mutations: MutationService,
) {
  const schedule = yield* readSchedule;
  if (!schedule.enabled || schedule.version !== version)
    return {
      published: false,
      nextAt: nextReviewOccurrence(schedule, now),
      version: schedule.version,
    };
  const local = localParts(now, schedule.timezone);
  if (local.time < schedule.localTime)
    return {
      published: false,
      nextAt: nextReviewOccurrence(schedule, now),
      version: schedule.version,
    };
  const id = `review-invitation:${local.date}`;
  const folded = yield* EventStore.loadFolded;
  const chat = folded.chats.get(PERSONAL_THREAD_ID);
  const exists = chat?.messages.some((message) => message.id === id);
  if (!exists) {
    const commands: BatchCommand[] = chat
      ? []
      : [
          {
            type: "chat.create",
            chatId: PERSONAL_THREAD_ID,
            input: { projectId: null, title: "My thread" },
          },
        ];
    commands.push({
      type: "chat.message",
      chatId: PERSONAL_THREAD_ID,
      messageId: id,
      role: "system",
      text: `Ready to plan ${local.date}? Review new requests and existing work, then choose what fits today. Open Needs review or tell me what time you have available.`,
    });
    yield* mutations.executeBatch({
      commands,
      actor: { kind: "agent", chatId: PERSONAL_THREAD_ID, model: "review-scheduler" },
      batchId: BatchId.make(id),
      now: new Date(now).toISOString(),
      reason: "Publish the configured daily review invitation",
    });
  }
  return {
    published: !exists,
    nextAt: nextReviewOccurrence(schedule, now),
    version: schedule.version,
  };
});
