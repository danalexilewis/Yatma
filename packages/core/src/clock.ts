// Copyright (c) T3 Tools / MIT — adapted for Yatma

export const DAY_MS = 86_400_000;

/**
 * Next event stamp: never go backwards relative to events this device has seen.
 * `at = max(now, lastSeenAt + 1ms)`.
 */
export function nextAt(lastSeenAt: string | null | undefined, now: string): string {
  if (lastSeenAt == null || lastSeenAt === "") return now;
  const lastMs = Date.parse(lastSeenAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(lastMs)) return now;
  if (!Number.isFinite(nowMs)) return new Date(lastMs + 1).toISOString();
  return new Date(Math.max(nowMs, lastMs + 1)).toISOString();
}

/** True when `at` is more than `dayMs` ahead of `now` (default one day). */
export function isTooFarAhead(at: string, now: string, dayMs: number = DAY_MS): boolean {
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return true;
  return atMs - nowMs > dayMs;
}
