// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { UsageGetResult } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

const DEFAULT_DAILY_CAP = 500_000;

export type UsageReservation = {
  readonly reservationId: string;
  readonly allowance: number;
  readonly day: string;
};

export type UsageSnapshot = UsageGetResult & { readonly reserved: number };

/** Durable daily token accounting. Reservations serialize with SQL transactions. */
export const MIGRATE_SQL = [
  `CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS usage_reservations (
    reservation_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    day TEXT NOT NULL,
    allowance INTEGER NOT NULL,
    settled INTEGER NOT NULL DEFAULT 0,
    actual INTEGER NOT NULL DEFAULT 0
  )`,
] as const;

export function currentDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getTokenCap(): number {
  const raw = globalThis.process?.env?.USAGE_DAILY_TOKEN_CAP;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DAILY_CAP;
}

export function resetsAtIso(now = new Date()): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString();
}

export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATE_SQL) yield* sql.unsafe(statement);
});

function getSnapshot(now = new Date()) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const day = currentDayKey(now);
    const rows = yield* sql<{ readonly used: number; readonly reserved: number }>`
      SELECT used, reserved FROM usage_daily WHERE day = ${day}
    `;
    return {
      used: rows[0]?.used ?? 0,
      reserved: rows[0]?.reserved ?? 0,
      limit: getTokenCap(),
      resetsAt: resetsAtIso(now),
    } satisfies UsageSnapshot;
  });
}

/** Reserve worst-case provider tokens before work; duplicate operation IDs attach to it. */
export function reserve(operationId: string, allowance: number, now = new Date()) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const day = currentDayKey(now);
    const amount = Math.max(0, Math.floor(allowance));
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const existing = yield* sql<{
          readonly reservation_id: string;
          readonly day: string;
          readonly allowance: number;
          readonly settled: number;
        }>`
          SELECT reservation_id, day, allowance, settled
          FROM usage_reservations WHERE operation_id = ${operationId}
        `;
        if (existing[0]) {
          const row = existing[0];
          return row.settled === 0 && row.day === day
            ? { ok: true as const, reservation: { reservationId: row.reservation_id, allowance: row.allowance, day: row.day } }
            : { ok: false as const, snapshot: yield* getSnapshot(now) };
        }
        yield* sql`INSERT OR IGNORE INTO usage_daily(day, used, reserved) VALUES (${day}, 0, 0)`;
        const rows = yield* sql<{ readonly used: number; readonly reserved: number }>`
          SELECT used, reserved FROM usage_daily WHERE day = ${day}
        `;
        const snapshot = rows[0] ?? { used: 0, reserved: 0 };
        if (snapshot.used + snapshot.reserved + amount > getTokenCap()) {
          return { ok: false as const, snapshot: { ...snapshot, limit: getTokenCap(), resetsAt: resetsAtIso(now) } };
        }
        const reservationId = `usage_${crypto.randomUUID()}`;
        yield* sql`
          INSERT INTO usage_reservations(reservation_id, operation_id, day, allowance)
          VALUES (${reservationId}, ${operationId}, ${day}, ${amount})
        `;
        yield* sql`UPDATE usage_daily SET reserved = reserved + ${amount} WHERE day = ${day}`;
        return { ok: true as const, reservation: { reservationId, allowance: amount, day } };
      }),
    );
  });
}

/** Settle exactly once, charging actual usage (including cap overshoot) and releasing remainder. */
export function settle(reservationId: string, actualTokens: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const actual = Math.max(0, Math.floor(actualTokens));
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          readonly day: string;
          readonly allowance: number;
          readonly settled: number;
        }>`
          SELECT day, allowance, settled FROM usage_reservations WHERE reservation_id = ${reservationId}
        `;
        const row = rows[0];
        if (!row || row.settled !== 0) return;
        yield* sql`UPDATE usage_reservations SET settled = 1, actual = ${actual} WHERE reservation_id = ${reservationId}`;
        yield* sql`UPDATE usage_daily SET reserved = MAX(0, reserved - ${row.allowance}), used = used + ${actual} WHERE day = ${row.day}`;
      }),
    );
    return yield* getSnapshot();
  });
}

/** Release a provider reservation when no usage was observed. */
export function release(reservationId: string) {
  return settle(reservationId, 0);
}

/** Group the ledger operations into one application port. */
export function makeLedger(sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>) {
  return {
    reserve: (operationId: string, allowance: number) => reserve(operationId, allowance).pipe(Effect.provide(sqlLayer)),
    settle: (reservationId: string, actualTokens: number) => settle(reservationId, actualTokens).pipe(Effect.provide(sqlLayer)),
    release: (reservationId: string) => release(reservationId).pipe(Effect.provide(sqlLayer)),
    get: () => getUsageSnapshot(sqlLayer),
  };
}

export function getUsage(sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>) {
  return getSnapshot().pipe(
    Effect.map(({ used, limit, resetsAt }) => ({ used, limit, resetsAt }) satisfies UsageGetResult),
    Effect.provide(sqlLayer),
  );
}

export function getUsageSnapshot(sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>) {
  return getSnapshot().pipe(Effect.provide(sqlLayer));
}

/** Legacy helper retained for callers being migrated to reservations. */
export function recordTokens(sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>, tokens: number) {
  return Effect.gen(function* () {
    const snap = yield* getSnapshot();
    const sql = yield* SqlClient.SqlClient;
    const next = snap.used + Math.max(0, Math.floor(tokens));
    yield* sql`INSERT INTO usage_daily(day, used, reserved) VALUES (${currentDayKey()}, ${next}, 0)
      ON CONFLICT(day) DO UPDATE SET used = ${next}`;
    return { ok: next <= snap.limit, snapshot: { ...snap, used: next } };
  }).pipe(Effect.provide(sqlLayer));
}

export function isOverCap(snapshot: UsageGetResult): boolean {
  return snapshot.used >= snapshot.limit;
}
