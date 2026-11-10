import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export type AccountDeletionStatus = "pending" | "completed";

export interface AccountDeletionRecord {
  readonly userId: string;
  readonly requestId: string;
  readonly status: AccountDeletionStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: string | null;
}

interface AccountDeletionRow {
  readonly user_id: string;
  readonly request_id: string;
  readonly status: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly last_error: string | null;
}

/** Durable lifecycle metadata deliberately lives outside the event-store tables. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS account_deletion (
      user_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    )
  `);
});

function toRecord(row: AccountDeletionRow | undefined): AccountDeletionRecord | null {
  if (!row || (row.status !== "pending" && row.status !== "completed")) return null;
  return {
    userId: row.user_id,
    requestId: row.request_id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

function readOne(userId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<AccountDeletionRow>`
      SELECT user_id, request_id, status, started_at, updated_at, last_error
      FROM account_deletion WHERE user_id = ${userId}
    `;
    return toRecord(rows[0]);
  });
}

/** Create a durable pending record once; retries always reuse its request ID. */
export const beginOrRead = Effect.fn("AccountDeletion.beginOrRead")(function* (
  userId: string,
  requestId = crypto.randomUUID(),
) {
  const sql = yield* SqlClient.SqlClient;
  const now = new Date().toISOString();
  yield* sql`
    INSERT OR IGNORE INTO account_deletion
      (user_id, request_id, status, started_at, updated_at, last_error)
    VALUES (${userId}, ${requestId}, 'pending', ${now}, ${now}, NULL)
  `;
  return yield* readOne(userId);
});

/** Mark the remote delete complete; stale retries cannot change the record. */
export const markRemoteComplete = Effect.fn("AccountDeletion.markRemoteComplete")(function* (
  userId: string,
  requestId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE account_deletion
    SET status = 'completed', updated_at = ${new Date().toISOString()}, last_error = NULL
    WHERE user_id = ${userId} AND request_id = ${requestId} AND status = 'pending'
  `;
  return yield* readOne(userId);
});

/** Keep the pending row and record why the remote deletion needs another try. */
export const markRemoteFailure = Effect.fn("AccountDeletion.markRemoteFailure")(
  function* (userId: string, requestId: string, error: string) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE account_deletion SET updated_at = ${new Date().toISOString()}, last_error = ${error}
      WHERE user_id = ${userId} AND request_id = ${requestId} AND status = 'pending'
    `;
    return yield* readOne(userId);
  },
);

/** Read the deletion fence used by the host to reject stale work. */
export const getStatus = readOne;
