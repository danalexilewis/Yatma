// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Schema from "effect/Schema";

/** Crockford base32 alphabet (no I, L, O, U). */
export const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const crockfordCharClass = "[0-9A-HJKMNP-TV-Z]";

function shortIdPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}${crockfordCharClass}{8}$`);
}

/** ULID-like: 26 Crockford base32 characters. */
const ULID_PATTERN = new RegExp(`^${crockfordCharClass}{26}$`);

export const TrimmedNonEmptyString = Schema.String.check(Schema.isNonEmpty());

export const TaskId = Schema.String.check(Schema.isPattern(shortIdPattern("t_"))).pipe(
  Schema.brand("TaskId"),
);
export type TaskId = typeof TaskId.Type;

export const ProjectId = Schema.String.check(Schema.isPattern(shortIdPattern("p_"))).pipe(
  Schema.brand("ProjectId"),
);
export type ProjectId = typeof ProjectId.Type;

export const PageId = Schema.String.check(Schema.isPattern(shortIdPattern("pg_"))).pipe(
  Schema.brand("PageId"),
);
export type PageId = typeof PageId.Type;

export const ChatId = Schema.String.check(Schema.isPattern(shortIdPattern("c_"))).pipe(
  Schema.brand("ChatId"),
);
export type ChatId = typeof ChatId.Type;

export const DeviceId = TrimmedNonEmptyString.pipe(Schema.brand("DeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const BatchId = TrimmedNonEmptyString.pipe(Schema.brand("BatchId"));
export type BatchId = typeof BatchId.Type;

/** Event ids are ULID-like (26 Crockford base32 chars). */
export const EventId = Schema.String.check(Schema.isPattern(ULID_PATTERN)).pipe(
  Schema.brand("EventId"),
);
export type EventId = typeof EventId.Type;

export type ShortIdPrefix = "t_" | "p_" | "pg_" | "c_";

function randomCrockford(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CROCKFORD_BASE32[bytes[i]! % 32]!;
  }
  return out;
}

/** Encode a millisecond timestamp as 10 Crockford base32 characters (ULID time part). */
function encodeUlidTime(ms: number): string {
  let value = ms;
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD_BASE32[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/** Short entity id: prefix plus 8 Crockford base32 characters. */
export function generateShortId(prefix: ShortIdPrefix): string {
  return `${prefix}${randomCrockford(8)}`;
}

/** ULID-like event id (26 Crockford base32 characters). */
export function generateEventId(): EventId {
  return EventId.make(`${encodeUlidTime(Date.now())}${randomCrockford(16)}`);
}
