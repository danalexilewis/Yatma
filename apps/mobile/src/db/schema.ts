/** SQLite DDL for the local-first event log and entity cache. */

export const DATABASE_NAME = "yatma.db";
export const DATABASE_SCHEMA_VERSION = 1;

/**
 * `events` is the append-only log. Rows without `seq` are the outbox
 * (not yet acknowledged by the server).
 * `entities` holds last-known folded snapshots for fast cold start.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  seq INTEGER,
  device_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_at_id ON events (at, id);
CREATE INDEX IF NOT EXISTS events_outbox ON events (seq) WHERE seq IS NULL;
CREATE INDEX IF NOT EXISTS events_seq ON events (seq) WHERE seq IS NOT NULL;

CREATE TABLE IF NOT EXISTS entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

export type EventRow = {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly payload: string;
  readonly seq: number | null;
  readonly device_id: string | null;
  readonly created_at: number;
};

export type EntityRow = {
  readonly kind: string;
  readonly id: string;
  readonly payload: string;
  readonly updated_at: string;
};
