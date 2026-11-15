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

export type EntityKind =
  | "project"
  | "task"
  | "page"
  | "chat"
  | "day"
  | "dayEntry"
  | "workInterval"
  | "stackTemplate"
  | "stackPreferences"
  | "review";

export type StoredEvent = Event & { readonly seq: number };

export type PushReject =
  | { readonly _tag: "invalid_event"; readonly id?: string; readonly reason: string }
  | { readonly _tag: "event_conflict"; readonly id: string; readonly reason: string }
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
    case "day.created":
      return event.day.id;
    case "day.updated":
      return event.dayId;
    case "dayEntry.created":
      return event.entry.id;
    case "dayEntry.updated":
      return event.entryId;
    case "workInterval.created":
      return event.interval.id;
    case "workInterval.updated":
      return event.intervalId;
    case "stackTemplate.saved":
      return event.template.id;
    case "stackPreferences.updated":
      return "default";
    case "review.received":
      return event.item.id;
    case "review.updated":
      return event.itemId;
  }
}

export function kindOf(event: Event): EntityKind {
  const kind = event.type.split(".")[0];
  if (
    kind === "project" ||
    kind === "task" ||
    kind === "page" ||
    kind === "chat" ||
    kind === "day" ||
    kind === "dayEntry" ||
    kind === "workInterval" ||
    kind === "stackTemplate" ||
    kind === "stackPreferences" ||
    kind === "review"
  ) {
    return kind;
  }
  throw new Error(`Unsupported entity kind: ${kind}`);
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

function rowToStored(row: EventRow): StoredEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch {
    throw new Error(`Unsupported or invalid stored event: ${row.id}`);
  }
  const event = parseWireEvent(raw);
  if (!event) throw new Error(`Unsupported or invalid stored event: ${row.id}`);
  return { ...event, seq: row.seq };
}

/**
 * Validate the full request, then append and refold it in one SQLite
 * transaction. A retry receives the original sequence for every event ID.
 */
export const pushEvents = Effect.fn("EventStore.pushEvents")(function* (
  rawEvents: readonly unknown[],
  nowIso: string,
) {
  const events: Event[] = [];
  const requestIds = new Map<string, string>();
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
    const payload = JSON.stringify(event);
    const repeated = requestIds.get(event.id);
    if (repeated !== undefined && repeated !== payload) {
      return {
        ok: false as const,
        reject: { _tag: "event_conflict" as const, id: event.id, reason: "content_mismatch" },
      };
    }
    requestIds.set(event.id, payload);
    events.push(event);
  }

  return yield* appendPreparedEvents(events);
});

/** Append trusted, planner-produced events using the same conflict rules as sync. */
export const appendPlannedBatch = Effect.fn("EventStore.appendPlannedBatch")(function* (
  events: readonly Event[],
) {
  for (const event of events) {
    if (!parseWireEvent(event)) {
      return {
        ok: false as const,
        reject: { _tag: "invalid_event" as const, id: event.id, reason: "decode_failed" },
      };
    }
  }
  return yield* appendPreparedEvents(events);
});

const appendPreparedEvents = Effect.fn("EventStore.appendPreparedEvents")(function* (
  events: readonly Event[],
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const accepted: EventId[] = [];
      const assigned: Array<{ readonly id: EventId; readonly seq: number }> = [];
      const touched = new Set<string>();
      const assignedIds = new Set<string>();
      const existingIds = new Set<string>();

      for (const event of events) {
        if (existingIds.has(event.id)) continue;
        const rows = yield* sql<{ readonly seq: number; readonly payload: string }>`
          SELECT seq, payload FROM events WHERE id = ${event.id}
        `;
        const row = rows[0];
        if (!row) continue;
        let existingEvent: Event | null = null;
        try {
          existingEvent = parseWireEvent(JSON.parse(row.payload));
        } catch {
          existingEvent = null;
        }
        if (!existingEvent || JSON.stringify(existingEvent) !== JSON.stringify(event)) {
          return {
            ok: false as const,
            reject: { _tag: "event_conflict" as const, id: event.id, reason: "content_mismatch" },
          };
        }
        existingIds.add(event.id);
        assigned.push({ id: event.id, seq: row.seq });
        assignedIds.add(event.id);
      }

      for (const event of events) {
        if (existingIds.has(event.id)) continue;
        const entityId = entityIdOf(event);
        const payload = JSON.stringify(event);
        const inserted = yield* sql<{ readonly seq: number }>`
          INSERT INTO events (id, entity_id, at, payload)
          VALUES (${event.id}, ${entityId}, ${event.at}, ${payload})
          ON CONFLICT (id) DO NOTHING
          RETURNING seq
        `;
        if (inserted.length === 0) {
          const rows = yield* sql<{ readonly seq: number }>`
            SELECT seq FROM events WHERE id = ${event.id}
          `;
          const row = rows[0];
          if (!row) throw new Error("event disappeared during append");
          if (!assignedIds.has(event.id)) {
            assigned.push({ id: event.id, seq: row.seq });
            assignedIds.add(event.id);
          }
          continue;
        }

        if (!assignedIds.has(event.id)) {
          accepted.push(event.id);
          touched.add(entityId);
          assigned.push({ id: event.id, seq: inserted[0]!.seq });
          assignedIds.add(event.id);
        }
      }

      // Terminal task events can resolve entries and intervals owned by another
      // entity. Project the shared full fold once so those records stay atomic.
      if (touched.size > 0) yield* refoldProjections;

      return {
        ok: true as const,
        result: { accepted, assigned } satisfies SyncPushResult,
      };
    }),
  );
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
  const events: StoredEvent[] = [];
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
export const eventsForBatch = Effect.fn("EventStore.eventsForBatch")(function* (batchId: string) {
  const all = yield* loadAllEvents;
  return all.filter((event) => event.batch === batchId);
});

/** Folded entity maps from the full event log. */
export const loadFolded = Effect.gen(function* () {
  const events = yield* loadAllEvents;
  return foldEvents(events);
});

const refoldProjections = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const folded = yield* loadFolded;
  const maps = [
    ["project", folded.projects],
    ["task", folded.tasks],
    ["page", folded.pages],
    ["chat", folded.chats],
    ["day", folded.days],
    ["dayEntry", folded.dayEntries],
    ["workInterval", folded.workIntervals],
    ["stackTemplate", folded.stackTemplates],
    ["stackPreferences", folded.stackPreferences],
    ["review", folded.reviewItems],
  ] as const;

  for (const [kind, entities] of maps) {
    for (const [entityId, state] of entities) {
      const json = JSON.stringify(state);
      yield* sql`
        INSERT INTO entities (id, kind, state)
        VALUES (${entityId}, ${kind}, ${json})
        ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, state = excluded.state
      `;
      // Time history and player preferences are not searchable backlog items.
      if (
        kind === "day" ||
        kind === "dayEntry" ||
        kind === "workInterval" ||
        kind === "stackTemplate" ||
        kind === "stackPreferences" ||
        kind === "review"
      )
        continue;
      const title = "title" in state && typeof state.title === "string" ? state.title : entityId;
      const body =
        "body" in state && typeof state.body === "string"
          ? state.body
          : "notes" in state && typeof state.notes === "string"
            ? state.notes
            : "summary" in state && typeof state.summary === "string"
              ? state.summary
              : "";
      yield* upsertFts({ entityId, kind, title, body });
    }
  }
});
