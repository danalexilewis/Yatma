import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as AccountDeletion from "./accountDeletion.ts";

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.all([EventStore.migrate, AccountDeletion.migrate]).pipe(
    Effect.andThen(effect),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );

describe("Account deletion lifecycle", () => {
  it.effect("keeps a pending request ID and failure metadata across repeated starts", () =>
    withStore(
      Effect.gen(function* () {
        const first = yield* AccountDeletion.beginOrRead("user_1", "delete_1");
        const failed = yield* AccountDeletion.markRemoteFailure(
          "user_1",
          "delete_1",
          "Clerk unavailable",
        );
        const retry = yield* AccountDeletion.beginOrRead("user_1", "different_retry_id");
        expect(first?.status).toBe("pending");
        expect(failed?.lastError).toBe("Clerk unavailable");
        expect(retry?.requestId).toBe("delete_1");
        expect(retry?.status).toBe("pending");
        expect(retry?.lastError).toBe("Clerk unavailable");
      }),
    ),
  );

  it.effect("makes completion terminal and idempotent", () =>
    withStore(
      Effect.gen(function* () {
        yield* AccountDeletion.beginOrRead("user_2", "delete_2");
        const completed = yield* AccountDeletion.markRemoteComplete("user_2", "delete_2");
        const repeated = yield* AccountDeletion.markRemoteComplete("user_2", "delete_2");
        const staleFailure = yield* AccountDeletion.markRemoteFailure(
          "user_2",
          "delete_2",
          "late failure",
        );
        expect(completed?.status).toBe("completed");
        expect(repeated).toEqual(completed);
        expect(staleFailure).toEqual(completed);
      }),
    ),
  );

  it.effect("keeps lifecycle state when event-store tables are cleared", () =>
    withStore(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* AccountDeletion.beginOrRead("user_3", "delete_3");
        yield* sql`INSERT INTO events (id, entity_id, at, payload)
          VALUES ('event_1', 'task_1', '2026-10-15T00:00:00.000Z', '{}')`;
        yield* sql`INSERT INTO entities (id, kind, state) VALUES ('task_1', 'task', '{}')`;
        yield* EventStore.clearAll;
        const status = yield* AccountDeletion.getStatus("user_3");
        expect(status?.status).toBe("pending");
        expect(status?.requestId).toBe("delete_3");
      }),
    ),
  );
});
