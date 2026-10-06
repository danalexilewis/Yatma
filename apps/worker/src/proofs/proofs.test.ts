// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DetachedTurn from "./detachedTurn.ts";
import * as Fts5 from "./fts5.ts";
import * as AgentStream from "./agentStream.ts";
import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";

describe("proofs/fts5", () => {
  it("exports FTS5 virtual table DDL", () => {
    expect(Fts5.isFts5Ddl(Fts5.FTS5_DDL)).toBe(true);
  });

  it.effect("runs FTS5 migrate + MATCH in SQLite", () =>
    EventStore.migrate.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          yield* EventStore.upsertFts({
            entityId: "t_SEARCH01",
            kind: "task",
            title: "Buy oat milk",
            body: "from the corner shop",
          });
          const hits = yield* EventStore.searchFts("oat");
          expect(hits.some((h) => h.entity_id === "t_SEARCH01")).toBe(true);
        }),
      ),
      Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
    ),
  );

  it("pure matcher falls back when needed", () => {
    const hits = Fts5.matchFtsRows(
      [{ entityId: "t_1", kind: "task", title: "Milk", body: "oat" }],
      "oat",
    );
    expect(hits).toEqual([{ entityId: "t_1", kind: "task", title: "Milk" }]);
  });
});

describe("proofs/detachedTurn", () => {
  it("completes after simulated socket close", () => {
    const registry = DetachedTurn.createRegistry();
    const turn = DetachedTurn.startTurn(registry, { chatId: "c_TESTTEST", text: "hello" });
    DetachedTurn.detachSocket(registry, turn.turnId);
    const done = DetachedTurn.completeTurn(registry, turn.turnId, { status: "completed" });
    expect(done?.status).toBe("completed");
    expect(DetachedTurn.getTurn(registry, turn.turnId)?.finishedAt).not.toBeNull();
  });
});

describe("proofs/agentStream", () => {
  it.effect("scripted LanguageModel stream", () =>
    AgentStream.agentStreamProof.pipe(
      Effect.tap((result) => Effect.sync(() => expect(result.ok).toBe(true))),
    ),
  );
});
