// Copyright (c) T3 Tools / MIT — adapted for Yatma
import {
  type ChatId,
  type ChatStreamItem,
  type TurnFrame,
  type TurnGetResult,
  type TurnReceipt,
  type TurnStartInput,
  type TurnStatus,
  ChatId as ChatIdSchema,
  InvalidRequest,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Ref from "effect/Ref";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";

import type { RuntimeContext } from "alchemy/RuntimeContext";

import type { MutationService } from "../application/mutations.ts";
import * as EventStore from "../eventStore.ts";
import * as Tools from "./tools.ts";
import * as Turn from "./turn.ts";
import type { ModelGateway } from "./modelGateway.ts";

type TurnRow = {
  readonly turn_id: string;
  readonly request_id: string;
  readonly chat_id: string;
  readonly batch_id: string;
  readonly status: TurnStatus;
  readonly input: string;
  readonly request_signature: string;
  readonly result_text: string | null;
  readonly error: string | null;
};

type PublishedTurnFrame = TurnFrame & { readonly turnId: string };

export const MIGRATE_SQL = [
  `CREATE TABLE IF NOT EXISTS agent_turns (
    turn_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    chat_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    request_signature TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT NOT NULL,
    result_text TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_turns_chat ON agent_turns(chat_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_turn_frames (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    item TEXT NOT NULL,
    PRIMARY KEY(turn_id, seq)
  )`,
] as const;

/** Create durable turn storage. Interrupted work is never replayed automatically. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATE_SQL) yield* sql.unsafe(statement);
});

function fingerprint(input: TurnStartInput): string {
  return JSON.stringify({
    messageId: input.messageId,
    chatId: input.chatId ?? null,
    projectId: input.projectId,
    text: input.text,
    events: input.events,
  });
}

function parseRowInput(raw: string): TurnStartInput {
  return JSON.parse(raw) as TurnStartInput;
}

function statusForItems(aborted: boolean, error: string | null): TurnStatus {
  if (aborted) return "stopped";
  return error ? "failed" : "completed";
}

function readFrames(turnId: string, after: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly seq: number; readonly item: string }>`
      SELECT seq, item FROM agent_turn_frames
      WHERE turn_id = ${turnId} AND seq > ${after} ORDER BY seq
    `;
    return rows.flatMap((row): TurnFrame[] => {
      try { return [{ seq: row.seq, item: JSON.parse(row.item) as ChatStreamItem }]; }
      catch { return []; }
    });
  });
}

/** Durable DO supervisor. Request disconnects do not own its child fibers. */
export function makeSupervisor<R = never>(input: {
  readonly sqlLayer: Layer.Layer<SqlClient.SqlClient, SqlError>;
  readonly mutations: MutationService;
  readonly model: string;
  readonly openRouterKey: string | null;
  readonly gateway?: ModelGateway;
  readonly scheduleBackground?: (work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}) {
  const controllers = new Map<string, AbortController>();

  return Effect.gen(function* () {
    const published = yield* PubSub.unbounded<PublishedTurnFrame>();

    const appendFrame = (turnId: string, item: ChatStreamItem) => Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly next: number }>`
        SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM agent_turn_frames WHERE turn_id = ${turnId}
      `;
      const seq = rows[0]?.next ?? 1;
      yield* sql`INSERT INTO agent_turn_frames(turn_id, seq, item) VALUES (${turnId}, ${seq}, ${JSON.stringify(item)})`;
      yield* PubSub.publish(published, { turnId, seq, item });
      return { seq, item } satisfies TurnFrame;
    });

    const setStatus = (turnId: string, status: TurnStatus, resultText: string | null, error: string | null) => Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE agent_turns SET status = ${status}, result_text = ${resultText}, error = ${error}, updated_at = ${new Date().toISOString()} WHERE turn_id = ${turnId}`;
    });

    function run(turnId: string, row: TurnRow, controller: AbortController) {
      const turnInput = parseRowInput(row.input);
      return Effect.gen(function* () {
        const resultText = yield* Ref.make("");
        const emittedDone = yield* Ref.make(false);
        const outcome = yield* Stream.runForEach(Turn.runAgentTurn({
          chatId: ChatIdSchema.make(row.chat_id),
          projectId: turnInput.projectId,
          text: turnInput.text,
          messageId: turnInput.messageId,
          requestId: turnInput.requestId,
          batchId: row.batch_id,
          turnId,
          model: input.model,
          openRouterKey: input.openRouterKey,
          signal: controller.signal,
          mutations: input.mutations,
          ...(input.gateway ? { gateway: input.gateway } : {}),
        }), (item) => Effect.gen(function* () {
          if (item.kind === "text_delta") yield* Ref.update(resultText, (text) => text + item.text);
          if (item.kind === "done") yield* Ref.set(emittedDone, true);
          if (item.kind !== "started") {
            yield* appendFrame(turnId, item).pipe(Effect.provide(input.sqlLayer));
          }
        })).pipe(Effect.provide(input.sqlLayer), Effect.result);

        let error: string | null = null;
        const turnOutcome = outcome as Result.Result<void, Turn.TurnFail>;
        if (Result.isFailure(turnOutcome)) error = turnOutcome.failure._tag === "Internal" ? turnOutcome.failure.message : "budget_exceeded";
        if (!(yield* Ref.get(emittedDone))) {
          const chatId = ChatIdSchema.make(row.chat_id);
          yield* appendFrame(turnId, { kind: "done", chatId, turnId }).pipe(Effect.provide(input.sqlLayer));
        }
        const status = statusForItems(controller.signal.aborted, error);
        yield* setStatus(turnId, status, (yield* Ref.get(resultText)) || null, error).pipe(Effect.provide(input.sqlLayer));
      }).pipe(
        Effect.catchCause((cause) => setStatus(turnId, "failed", null, String(cause)).pipe(Effect.provide(input.sqlLayer), Effect.ignore)),
        Effect.ensuring(Effect.sync(() => controllers.delete(turnId))),
      );
    }

    const start = (request: TurnStartInput) => Effect.gen(function* () {
      const requestedChatId = request.chatId ?? Turn.newChatId();
      const normalized = { ...request, chatId: requestedChatId };
      const serialized = fingerprint(normalized);
      const signature = fingerprint(request);
      const turnId = `turn_${crypto.randomUUID()}`;
      const batchId = Tools.newBatchId();
      const now = new Date().toISOString();
      const sql = yield* SqlClient.SqlClient;
      const inserted = yield* sql.withTransaction(Effect.gen(function* () {
        const rows = yield* sql<TurnRow>`SELECT turn_id, request_id, chat_id, batch_id, request_signature, status, input, result_text, error FROM agent_turns WHERE request_id = ${request.requestId}`;
        if (rows[0]) {
          if (rows[0].request_signature !== signature) return { conflict: true as const };
          return { conflict: false as const, created: false as const, row: rows[0] };
        }
        yield* sql`INSERT INTO agent_turns(turn_id, request_id, chat_id, batch_id, request_signature, status, input, created_at, updated_at)
          VALUES (${turnId}, ${request.requestId}, ${requestedChatId}, ${batchId}, ${signature}, 'queued', ${serialized}, ${now}, ${now})`;
        yield* sql`INSERT INTO agent_turn_frames(turn_id, seq, item) VALUES (${turnId}, 1, ${JSON.stringify({ kind: "started", chatId: requestedChatId, turnId })})`;
        return { conflict: false as const, created: true as const, row: {
          turn_id: turnId, request_id: request.requestId, chat_id: requestedChatId,
          batch_id: batchId, request_signature: signature, status: "queued" as const, input: serialized,
          result_text: null, error: null,
        } };
      }));
      if (inserted.conflict) return yield* Effect.fail(new InvalidRequest({ message: "turn_request_conflict" }));
      const row = inserted.row;
      let receiptStatus = row.status;
      if (inserted.created) {
        if (request.events.length > 0) {
          const pushed = yield* input.mutations.pushIncomingBatch(request.events, now).pipe(Effect.provide(input.sqlLayer));
          if (!pushed.ok) {
            yield* setStatus(row.turn_id, "failed", null, "incoming_events_rejected");
            return { turnId: row.turn_id, chatId: ChatIdSchema.make(row.chat_id), batchId: row.batch_id, status: "failed" } satisfies TurnReceipt;
          }
        }
        yield* sql`UPDATE agent_turns SET status = 'running', updated_at = ${new Date().toISOString()} WHERE turn_id = ${row.turn_id} AND status = 'queued'`;
        const currentRows = yield* sql<{ readonly status: TurnStatus }>`SELECT status FROM agent_turns WHERE turn_id = ${row.turn_id}`;
        const currentStatus = currentRows[0]?.status ?? "failed";
        receiptStatus = currentStatus;
        if (currentStatus === "running") {
          const controller = new AbortController();
          controllers.set(row.turn_id, controller);
          const work = run(row.turn_id, { ...row, status: "running" }, controller)
            .pipe(Effect.provide(input.sqlLayer), Effect.ignore);
          if (input.scheduleBackground) yield* input.scheduleBackground(work);
          else yield* work.pipe(Effect.forkDetach);
        }
        yield* PubSub.publish(published, { turnId: row.turn_id, seq: 1, item: { kind: "started", chatId: ChatIdSchema.make(row.chat_id), turnId: row.turn_id } });
      }
      return { turnId: row.turn_id, chatId: ChatIdSchema.make(row.chat_id), batchId: row.batch_id, status: receiptStatus } satisfies TurnReceipt;
    }).pipe(Effect.provide(input.sqlLayer));

    const get = (turnId: string) => Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<TurnRow>`SELECT turn_id, request_id, chat_id, batch_id, request_signature, status, input, result_text, error FROM agent_turns WHERE turn_id = ${turnId}`;
      const row = rows[0];
      if (!row) return null;
      const receipt = { turnId: row.turn_id, chatId: ChatIdSchema.make(row.chat_id), batchId: row.batch_id, status: row.status };
      if (["queued", "running"].includes(row.status)) {
        return { receipt, resultText: null, batches: [], error: null } satisfies TurnGetResult;
      }
      const events = yield* EventStore.eventsForBatch(row.batch_id);
      return {
        receipt,
        resultText: row.result_text,
        batches: [{ batchId: row.batch_id, events, summary: events.length ? `${events.length} committed changes` : "No committed changes" }],
        error: row.error,
      } satisfies TurnGetResult;
    }).pipe(Effect.provide(input.sqlLayer));

    const stop = (turnId: string) => Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      controllers.get(turnId)?.abort();
      const rows = yield* sql<{ readonly status: TurnStatus }>`SELECT status FROM agent_turns WHERE turn_id = ${turnId}`;
      if (!rows[0]) return { found: false as const };
      if (rows[0].status === "queued" || rows[0].status === "running") {
        yield* setStatus(turnId, "stopped", null, null);
      }
      return { found: true as const };
    }).pipe(Effect.provide(input.sqlLayer));

    const stopAll = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly turn_id: string }>`SELECT turn_id FROM agent_turns WHERE status IN ('queued', 'running')`;
      for (const row of rows) controllers.get(row.turn_id)?.abort();
      yield* sql`UPDATE agent_turns SET status = 'stopped', error = 'account_deleted', updated_at = ${new Date().toISOString()} WHERE status IN ('queued', 'running')`;
    }).pipe(Effect.provide(input.sqlLayer));

    const recover = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE agent_turns SET status = 'interrupted', error = 'durable_object_restarted', updated_at = ${new Date().toISOString()} WHERE status IN ('queued', 'running')`;
    }).pipe(Effect.provide(input.sqlLayer), Effect.orDie);

    const observe = (turnId: string, after: number) => Stream.unwrap(Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(published);
      const initial = yield* readFrames(turnId, after).pipe(Effect.provide(input.sqlLayer));
      const status = yield* get(turnId);
      if (status === null || ["completed", "stopped", "failed", "interrupted"].includes(status.receipt.status)) {
        return Stream.fromIterable(initial);
      }
      let cursor = initial.at(-1)?.seq ?? after;
      const live = Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
        Stream.filter((frame) => frame.turnId === turnId && frame.seq > cursor),
        Stream.tap((frame) => Effect.sync(() => { cursor = frame.seq; })),
        Stream.map(({ seq, item }) => ({ seq, item })),
      );
      return Stream.concat(Stream.fromIterable(initial), live);
    }));

    return { start, get, stop, stopAll, recover, observe };
  });
}
