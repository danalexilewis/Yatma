// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import { ChatId, type TurnStartInput } from "@yatma/core";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as EventStore from "../eventStore.ts";
import * as Mutations from "../application/mutations.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as ModelGateway from "./modelGateway.ts";
import * as Usage from "./usage.ts";
import * as Supervisor from "./supervisor.ts";

const sqlLayer = NodeSqlite.layer({ filename: ":memory:" });

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* EventStore.migrate;
    yield* Usage.migrate;
    yield* Supervisor.migrate;
    return yield* effect;
  }).pipe(Effect.provide(sqlLayer));

function startInput(requestId: string, text: string): TurnStartInput {
  return {
    requestId,
    messageId: `message_${requestId}`,
    projectId: null,
    text,
    events: [],
  };
}

describe("worker turn supervisor", () => {
  it.effect("deduplicates request identity and persists scripted result", () =>
    withStore(Effect.gen(function* () {
      const hub = yield* Mutations.makeCommitHub;
      const mutations = Mutations.makeMutationService(hub);
      const gateway = ModelGateway.makeScriptedGateway([
        { text: "First reply", tokens: 17, toolCalls: [] },
        { text: "Second reply", tokens: 9, toolCalls: [] },
      ]);
      const supervisor = yield* Supervisor.makeSupervisor({
        sqlLayer,
        mutations,
        model: "scripted",
        openRouterKey: "scripted",
        gateway,
      });

      const first = yield* supervisor.start(startInput("request-a", "Repeat this"));
      const retry = yield* supervisor.start(startInput("request-a", "Repeat this"));
      expect(retry.turnId).toBe(first.turnId);
      expect(retry.chatId).toBe(first.chatId);

      const second = yield* supervisor.start(startInput("request-b", "Repeat this"));
      expect(second.turnId).not.toBe(first.turnId);

      for (let attempt = 0; attempt < 200; attempt += 1) yield* Effect.yieldNow;
      const sql = yield* SqlClient.SqlClient;
      const firstRows = yield* sql<{ readonly status: string; readonly result_text: string | null }>`SELECT status, result_text FROM agent_turns WHERE turn_id = ${first.turnId}`;
      const secondRows = yield* sql<{ readonly status: string; readonly result_text: string | null }>`SELECT status, result_text FROM agent_turns WHERE turn_id = ${second.turnId}`;
      expect(firstRows[0]?.status).toBe("completed");
      expect(firstRows[0]?.result_text).toBe("First reply");
      expect(secondRows[0]?.status).toBe("completed");
      expect(secondRows[0]?.result_text).toBe("Second reply");
      const firstFrames = yield* sql<{ readonly seq: number; readonly item: string }>`SELECT seq, item FROM agent_turn_frames WHERE turn_id = ${first.turnId} ORDER BY seq`;
      const textFrame = firstFrames.find((frame) => JSON.parse(frame.item).kind === "text_delta");
      const doneFrame = firstFrames.find((frame) => JSON.parse(frame.item).kind === "done");
      expect(JSON.parse(textFrame?.item ?? "null").text).toBe("First reply");
      expect((textFrame?.seq ?? Infinity) < (doneFrame?.seq ?? -Infinity)).toBe(true);
      expect(gateway.remaining()).toBe(0);
    }))),

  it.effect("publishes text while the gateway is still open", () =>
    withStore(Effect.gen(function* () {
      const hub = yield* Mutations.makeCommitHub;
      const gate = yield* Deferred.make<void>();
      let providerFinished = false;
      const gateway: ModelGateway.ModelGateway = {
        stream: () => Stream.concat(
          Stream.make({ type: "text", text: "Early text" }),
          Stream.fromEffect(Deferred.await(gate).pipe(
            Effect.tap(() => Effect.sync(() => { providerFinished = true; })),
            Effect.as({ type: "usage" as const, tokens: 5 }),
          )),
        ),
      };
      const supervisor = yield* Supervisor.makeSupervisor({
        sqlLayer,
        mutations: Mutations.makeMutationService(hub),
        model: "scripted",
        openRouterKey: "scripted",
        gateway,
      });
      const receipt = yield* supervisor.start(startInput("request-gated", "Stream this"));
      const textFrame = yield* Stream.runHead(
        supervisor.observe(receipt.turnId, 1).pipe(
          Stream.filter((frame) => frame.item.kind === "text_delta"),
        ),
      );
      expect(Option.isSome(textFrame)).toBe(true);
      if (Option.isSome(textFrame) && textFrame.value.item.kind === "text_delta") {
        expect(textFrame.value.item.text).toBe("Early text");
      }
      expect(providerFinished).toBe(false);
      yield* Deferred.succeed(gate, undefined);
      for (let attempt = 0; attempt < 200; attempt += 1) yield* Effect.yieldNow;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly status: string }>`SELECT status FROM agent_turns WHERE turn_id = ${receipt.turnId}`;
      expect(rows[0]?.status).toBe("completed");
      const completed = yield* supervisor.get(receipt.turnId);
      expect(completed?.resultText).toBe("Early text");
    }))),

  it.effect("marks queued or running turns interrupted during restart recovery", () =>
    withStore(Effect.gen(function* () {
      const now = new Date().toISOString();
      const chatId = ChatId.make("c_REC0VRY1");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO agent_turns(turn_id, request_id, chat_id, batch_id, request_signature, status, input, created_at, updated_at)
        VALUES ('turn_recover', 'request_recover', ${chatId}, 'batch_recover', '{}', 'running', '{}', ${now}, ${now})`;
      const hub = yield* Mutations.makeCommitHub;
      const supervisor = yield* Supervisor.makeSupervisor({
        sqlLayer,
        mutations: Mutations.makeMutationService(hub),
        model: "scripted",
        openRouterKey: null,
      });
      yield* supervisor.recover;
      const recovered = yield* supervisor.get("turn_recover");
      expect(recovered?.receipt.status).toBe("interrupted");
    })));
});
