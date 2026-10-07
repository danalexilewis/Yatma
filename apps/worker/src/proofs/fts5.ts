// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { MIGRATE_SQL } from "../eventStore.ts";

/**
 * FTS5 migration fragment used by UserSpace SQLite.
 * Unit-testable without a Durable Object: run against any SQLite that has FTS5.
 */
export const FTS5_DDL = MIGRATE_SQL.find((s) => s.includes("search_fts"))!;

export function isFts5Ddl(sql: string): boolean {
  return /CREATE\s+VIRTUAL\s+TABLE/i.test(sql) && /USING\s+fts5/i.test(sql);
}

export type FtsHit = {
  readonly entityId: string;
  readonly kind: string;
  readonly title: string;
};

/**
 * Pure matcher used when a real FTS engine is unavailable in the test host.
 * Production search uses SQLite FTS5 `MATCH` in the Durable Object.
 */
export function matchFtsRows(
  rows: readonly {
    readonly entityId: string;
    readonly kind: string;
    readonly title: string;
    readonly body: string;
  }[],
  query: string,
): FtsHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return rows
    .filter(
      (row) =>
        row.title.toLowerCase().includes(needle) || row.body.toLowerCase().includes(needle),
    )
    .map((row) => ({ entityId: row.entityId, kind: row.kind, title: row.title }));
}
