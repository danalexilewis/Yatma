// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { UsageGetResult } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../eventStore.ts";

const META_MONTH = "usage.month";
const META_TOKENS = "usage.tokens";

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getTokenCap(): number {
  const raw = globalThis.process?.env?.USAGE_MONTHLY_TOKEN_CAP;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 500_000;
}

/** First day of next UTC month as ISO reset time. */
function resetsAtIso(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)).toISOString();
}

export function getUsage(sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>) {
  return Effect.gen(function* () {
    const month = currentMonthKey();
    const storedMonth = yield* EventStore.getMeta(META_MONTH);
    if (storedMonth !== month) {
      yield* EventStore.setMeta(META_MONTH, month);
      yield* EventStore.setMeta(META_TOKENS, "0");
    }
    const tokensRaw = yield* EventStore.getMeta(META_TOKENS);
    const used = Number(tokensRaw ?? "0") || 0;
    return {
      used,
      limit: getTokenCap(),
      resetsAt: resetsAtIso(),
    } satisfies UsageGetResult;
  }).pipe(Effect.provide(sqlLayer));
}

export function recordTokens(
  sqlLayer: Layer.Layer<SqlClient.SqlClient, unknown>,
  tokens: number,
) {
  return Effect.gen(function* () {
    const snap = yield* getUsage(sqlLayer);
    const next = snap.used + Math.max(0, tokens);
    if (next > snap.limit) {
      return { ok: false as const, snapshot: snap };
    }
    yield* EventStore.setMeta(META_TOKENS, String(next));
    return {
      ok: true as const,
      snapshot: { ...snap, used: next } satisfies UsageGetResult,
    };
  }).pipe(Effect.provide(sqlLayer));
}

export function isOverCap(snapshot: UsageGetResult): boolean {
  return snapshot.used >= snapshot.limit;
}
