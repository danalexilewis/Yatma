// Copyright (c) T3 Tools / MIT — adapted for Yatma
import {
  type Event,
  Event as EventSchema,
  type EventId,
  foldEvents,
  isTooFarAhead,
  type SyncBatch,
  type SyncPushResult,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeEvent = Schema.decodeUnknownOption(EventSchema);

export type EntityKind = "project" | "task" | "page" | "chat";

export type StoredEvent = Event & { readonly seq: number };

export type PushReject =
  | { readonly _tag: "invalid_event"; readonly id?: string; readonly reason: string }
  | { readonly _tag: "clock_skew"; readonly id: string; readonly at: string };

export type PushResult =
  | { readonly ok: true; readonly result: SyncPushResult }
  | { readonly ok: false; readonly reject: PushReject };

/** Shared DDL for Durable Object SQLite (and node:sqlite tests). */
export const MIGRATE_SQL = [
  `CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    entity_id TEXT NOT NULL,
    at TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_entity ON events (entity_id, seq)`,
  `CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    state TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    entity_id UNINDEXED,
    kind UNINDEXED,
    title,
    body
  )`,
] as const;

export function entityIdOf(event: Event): string {
  switch (event.type) {
    case "project.created":
    case "project.updated":
      return event.projectId;
    case "task.created":
    case "task.updated":
      return event.taskId;
    case "page.created":
    case "page.updated":
      return event.pageId;
    case "chat.created":
    case "chat.message":
    case "chat.updated":
      return event.chatId;
  }
}

export function kindOf(event: Event): EntityKind {
  const kind = event.type.split(".")[0];
  if (kind === "project" || kind === "task" || kind === "page" || kind === "chat") {
    return kind;
  }
  return "task";
}

export function parseWireEvent(raw: unknown): Event | null {
  const decoded = decodeEvent(raw);
  return Option.isSome(decoded) ? decoded.value : null;
}

/** Reject when client `at` is more than one day ahead of `nowIso`. */
export function rejectIfClockSkew(
  event: Event,
  nowIso: string,
): Extract<PushReject, { _tag: "clock_skew" }> | null {
  if (isTooFarAhead(event.at, nowIso)) {
    return { _tag: "clock_skew", id: event.id, at: event.at };
  }
  return null;
}

export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATE_SQL) {
    yield* sql.unsafe(statement);
  }
});

interface EventRow {
  readonly seq: number;
  readonly id: string;
  readonly entity_id: string;
  readonly at: string;
  readonly payload: string;
}

interface EntityRow {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
}

function rowToStored(row: EventRow): StoredEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const event = parseWireEvent(raw);
  if (!event) return null;
  return { ...event, seq: row.seq };
}

/** Append events; duplicate ids are ignored; assigns increasing seq. */
export const pushEvents = Effect.fn("EventStore.pushEvents")(function* (
  rawEvents: readonly unknown[],
  nowIso: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const accepted: EventId[] = [];
  const assigned: Array<{ readonly id: EventId; readonly seq: number }> = [];
  const touched = new Set<string>();

  for (const raw of rawEvents) {
    const event = parseWireEvent(raw);
    if (!event) {
      const reject: PushReject = {
        _tag: "invalid_event",
        reason: "decode_failed",
        ...(typeof raw === "object" &&
        raw !== null &&
        "id" in raw &&
        typeof (raw as { id: unknown }).id === "string"
          ? { id: (raw as { id: string }).id }
          : {}),
      };
      return { ok: false as const, reject };
    }
    const skew = rejectIfClockSkew(event, nowIso);
    if (skew) return { ok: false as const, reject: skew };

    const entityId = entityIdOf(event);
    const payload = JSON.stringify(event);
    const inserted = yield* sql<{ readonly seq: number }>`
      INSERT INTO events (id, entity_id, at, payload)
      VALUES (${event.id}, ${entityId}, ${event.at}, ${payload})
      ON CONFLICT (id) DO NOTHING
      RETURNING seq
    `;
    if (inserted.length === 0) continue;
    const seq = inserted[0]!.seq;
    accepted.push(event.id);
    assigned.push({ id: event.id, seq });
    touched.add(entityId);
  }

  for (const entityId of touched) {
    yield* refoldEntity(entityId);
  }

  return {
    ok: true as const,
    result: { accepted, assigned } satisfies SyncPushResult,
  };
});

/** Events with seq > after, ordered by seq. */
export const eventsAfter = Effect.fn("EventStore.eventsAfter")(function* (after: number) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<EventRow>`
    SELECT seq, id, entity_id, at, payload
    FROM events
    WHERE seq > ${after}
    ORDER BY seq ASC
  `;
  const events: StoredEvent[] = [];
  for (const row of rows) {
    const stored = rowToStored(row);
    if (stored) events.push(stored);
  }
  const nextAfter = events.length > 0 ? events[events.length - 1]!.seq : after;
  return { events, after: nextAfter } satisfies SyncBatch;
});

export const getEntity = Effect.fn("EventStore.getEntity")(function* (id: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<EntityRow>`SELECT id, kind, state FROM entities WHERE id = ${id}`;
  const row = rows[0];
  if (!row) return null;
  try {
    return { id: row.id, kind: row.kind as EntityKind, state: JSON.parse(row.state) as unknown };
  } catch {
    return null;
  }
});

export const clearAll = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM events`;
  yield* sql`DELETE FROM entities`;
  yield* sql`DELETE FROM meta`;
  yield* sql`DELETE FROM search_fts`;
});

export const getMeta = Effect.fn("EventStore.getMeta")(function* (key: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly value: string }>`
    SELECT value FROM meta WHERE key = ${key}
  `;
  return rows[0]?.value ?? null;
});

export const setMeta = Effect.fn("EventStore.setMeta")(function* (key: string, value: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO meta (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `;
});

/** Upsert FTS row used by search proof / agent search tool. */
export const upsertFts = Effect.fn("EventStore.upsertFts")(function* (input: {
  readonly entityId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM search_fts WHERE entity_id = ${input.entityId}`;
  yield* sql`
    INSERT INTO search_fts (entity_id, kind, title, body)
    VALUES (${input.entityId}, ${input.kind}, ${input.title}, ${input.body})
  `;
});

export const searchFts = Effect.fn("EventStore.searchFts")(function* (query: string) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly entity_id: string;
    readonly kind: string;
    readonly title: string;
  }>`
    SELECT entity_id, kind, title
    FROM search_fts
    WHERE search_fts MATCH ${query}
    LIMIT 50
  `;
});

/** All events ordered for folding (worker agent tools + context). */
export const loadAllEvents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<EventRow>`
    SELECT seq, id, entity_id, at, payload
    FROM events
    ORDER BY at ASC, id ASC
  `;
  const events: Event[] = [];
  for (const row of rows) {
    const stored = rowToStored(row);
    if (stored) events.push(stored);
  }
  return events;
});

/** Events for one entity, oldest first. */
export const eventsForEntity = Effect.fn("EventStore.eventsForEntity")(function* (
  entityId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<EventRow>`
    SELECT seq, id, entity_id, at, payload
    FROM events
    WHERE entity_id = ${entityId}
    ORDER BY at ASC, id ASC
  `;
  const events: Event[] = [];
  for (const row of rows) {
    const stored = rowToStored(row);
    if (stored) events.push(stored);
  }
  return events;
});

/** Events that share a batch id (for undo). */
export const eventsForBatch = Effect.fn("EventStore.eventsForBatch")(function* (
  batchId: string,
) {
  const all = yield* loadAllEvents;
  return all.filter((event) => event.batch === batchId);
});

/** Folded entity maps from the full event log. */
export const loadFolded = Effect.gen(function* () {
  const events = yield* loadAllEvents;
  return foldEvents(events);
});

const refoldEntity = (entityId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<EventRow>`
      SELECT seq, id, entity_id, at, payload
      FROM events
      WHERE entity_id = ${entityId}
      ORDER BY at ASC, id ASC
    `;
    const events: Event[] = [];
    let kind: EntityKind = "task";
    for (const row of rows) {
      const stored = rowToStored(row);
      if (!stored) continue;
      events.push(stored);
      kind = kindOf(stored);
    }
    if (events.length === 0) {
      yield* sql`DELETE FROM entities WHERE id = ${entityId}`;
      yield* sql`DELETE FROM search_fts WHERE entity_id = ${entityId}`;
      return;
    }
    const folded = foldEvents(events);
    const state = entityStateFromFold(entityId, kind, folded);
    if (!state) {
      yield* sql`DELETE FROM entities WHERE id = ${entityId}`;
      return;
    }
    const json = JSON.stringify(state);
    yield* sql`
      INSERT INTO entities (id, kind, state)
      VALUES (${entityId}, ${kind}, ${json})
      ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, state = excluded.state
    `;
    const title =
      typeof state === "object" &&
      state !== null &&
      "title" in state &&
      typeof (state as { title: unknown }).title === "string"
        ? (state as { title: string }).title
        : entityId;
    const body =
      typeof state === "object" && state !== null
        ? "body" in state && typeof (state as { body: unknown }).body === "string"
          ? (state as { body: string }).body
          : "notes" in state && typeof (state as { notes: unknown }).notes === "string"
            ? (state as { notes: string }).notes
            : "summary" in state && typeof (state as { summary: unknown }).summary === "string"
              ? ((state as { summary: string | null }).summary ?? "")
              : ""
        : "";
    yield* upsertFts({ entityId, kind, title, body });
  });

function entityStateFromFold(
  entityId: string,
  kind: EntityKind,
  folded: ReturnType<typeof foldEvents>,
): unknown | null {
  switch (kind) {
    case "project":
      return folded.projects.get(entityId as never) ?? null;
    case "task":
      return folded.tasks.get(entityId as never) ?? null;
    case "page":
      return folded.pages.get(entityId as never) ?? null;
    case "chat":
      return folded.chats.get(entityId as never) ?? null;
  }
}
