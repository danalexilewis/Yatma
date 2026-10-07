import type {
  Chat,
  ChatId,
  Event,
  FoldedEntities,
  Page,
  PageId,
  Project,
  ProjectId,
  Task,
  TaskId,
} from "@yatma/core";
import { encodeEvent, foldEvents, parseEventLine } from "@yatma/core";
import type { SQLiteDatabase } from "expo-sqlite";
import * as SQLite from "expo-sqlite";

import {
  entityRowsFromFolded,
  foldedFromCache,
  lastSeenAtFromEvents,
  type CachedEntityMaps,
  type EntityKind,
} from "./entities";
import {
  DATABASE_NAME,
  DATABASE_SCHEMA_VERSION,
  SCHEMA_SQL,
  type EntityRow,
  type EventRow,
} from "./schema";

const DEVICE_ID_META_KEY = "deviceId";

let databasePromise: Promise<SQLiteDatabase> | null = null;

/** Open (or reuse) the local Yatma database and migrate schema. */
export async function openDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initDatabase();
  }
  return databasePromise;
}

async function initDatabase(): Promise<SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(SCHEMA_SQL);
  const versionRow = await database.getFirstAsync<{ readonly user_version: number }>(
    "PRAGMA user_version",
  );
  const current = versionRow?.user_version ?? 0;
  if (current < DATABASE_SCHEMA_VERSION) {
    await database.execAsync(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`);
  }
  return database;
}

function createDeviceId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "dev_";
  for (let i = 0; i < 16; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

/** Stable device id persisted in `sync_meta`. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getSyncMeta(DEVICE_ID_META_KEY);
  if (existing) return existing;
  const deviceId = createDeviceId();
  await setSyncMeta(DEVICE_ID_META_KEY, deviceId);
  return deviceId;
}

/** Persist an event. Omit `seq` for outbox rows. */
export async function appendEvent(event: Event): Promise<void> {
  const database = await openDatabase();
  const payload = JSON.stringify(event);
  await database.runAsync(
    `INSERT OR REPLACE INTO events (id, at, type, payload, seq, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    event.at,
    event.type,
    payload,
    event.seq ?? null,
    event.by.kind === "user" ? event.by.deviceId : null,
    Date.now(),
  );
}

/** Upsert folded entity snapshots (full replace of known kinds). */
export async function upsertEntities(folded: FoldedEntities): Promise<void> {
  const database = await openDatabase();
  const rows = entityRowsFromFolded(folded);
  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const row of rows) {
      await tx.runAsync(
        `INSERT INTO entities (kind, id, payload, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        row.kind,
        row.id,
        row.payload,
        row.updatedAt,
      );
    }
  });
}

/** Upsert a single entity row from folded state. */
export async function upsertEntity(
  kind: EntityKind,
  id: string,
  payload: unknown,
  updatedAt: string,
): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    `INSERT INTO entities (kind, id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    kind,
    id,
    JSON.stringify(payload),
    updatedAt,
  );
}

/** Append an event and refresh the entity cache from the new fold. */
export async function appendEventAndUpsert(
  event: Event,
  previous: FoldedEntities,
): Promise<FoldedEntities> {
  const next = foldEvents([...previous.events, event]);
  const database = await openDatabase();
  await database.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT OR REPLACE INTO events (id, at, type, payload, seq, device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.at,
      event.type,
      JSON.stringify(event),
      event.seq ?? null,
      event.by.kind === "user" ? event.by.deviceId : null,
      Date.now(),
    );
    const rows = entityRowsFromFolded(next);
    for (const row of rows) {
      await tx.runAsync(
        `INSERT INTO entities (kind, id, payload, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        row.kind,
        row.id,
        row.payload,
        row.updatedAt,
      );
    }
  });
  return next;
}

/** Load cached entity maps, or null when the cache is empty. */
export async function loadCachedEntities(): Promise<CachedEntityMaps | null> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<EntityRow>(
    `SELECT kind, id, payload, updated_at FROM entities`,
  );
  if (rows.length === 0) return null;

  const projects = new Map<ProjectId, Project>();
  const tasks = new Map<TaskId, Task>();
  const pages = new Map<PageId, Page>();
  const chats = new Map<ChatId, Chat>();

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      continue;
    }
    switch (row.kind) {
      case "project":
        projects.set(row.id as ProjectId, parsed as Project);
        break;
      case "task":
        tasks.set(row.id as TaskId, parsed as Task);
        break;
      case "page":
        pages.set(row.id as PageId, parsed as Page);
        break;
      case "chat":
        chats.set(row.id as ChatId, parsed as Chat);
        break;
    }
  }

  return { projects, tasks, pages, chats };
}

export type HydratedLocalState = {
  readonly folded: FoldedEntities;
  readonly deviceId: string;
  readonly lastSeenAt: string | null;
};

/**
 * Cold start: prefer entity cache when present, otherwise fold the event log.
 * Backfills the cache when folding from events.
 */
export async function hydrateLocalState(): Promise<HydratedLocalState> {
  await openDatabase();
  const deviceId = await getOrCreateDeviceId();
  const events = await loadAllEvents();
  const cached = await loadCachedEntities();

  if (cached) {
    const folded = foldedFromCache(cached, events);
    return {
      folded,
      deviceId,
      lastSeenAt: lastSeenAtFromEvents(events),
    };
  }

  const folded = foldEvents(events);
  if (events.length > 0) {
    await upsertEntities(folded);
  }
  return {
    folded,
    deviceId,
    lastSeenAt: lastSeenAtFromEvents(events),
  };
}

/** Load all events ordered for folding. */
export async function loadAllEvents(): Promise<Event[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<EventRow>(
    `SELECT id, at, type, payload, seq, device_id, created_at
     FROM events
     ORDER BY at ASC, id ASC`,
  );
  const events: Event[] = [];
  for (const row of rows) {
    const parsed = parseEventLine(row.payload);
    if (parsed.ok) events.push(parsed.event);
  }
  return events;
}

/** Outbox = events that have not received a server `seq`. */
export async function loadOutboxEvents(): Promise<Event[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<EventRow>(
    `SELECT id, at, type, payload, seq, device_id, created_at
     FROM events
     WHERE seq IS NULL
     ORDER BY at ASC, id ASC`,
  );
  const events: Event[] = [];
  for (const row of rows) {
    const parsed = parseEventLine(row.payload);
    if (parsed.ok) events.push(parsed.event);
  }
  return events;
}

/** Stamp server sequence onto a previously local event. */
export async function assignEventSeq(eventId: string, seq: number): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(`UPDATE events SET seq = ? WHERE id = ?`, seq, eventId);
}

/** Merge remote events (idempotent by id) and refresh entity cache. */
export async function upsertRemoteEvents(events: readonly Event[]): Promise<FoldedEntities> {
  const database = await openDatabase();
  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const event of events) {
      await tx.runAsync(
        `INSERT INTO events (id, at, type, payload, seq, device_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           seq = COALESCE(excluded.seq, events.seq),
           payload = excluded.payload`,
        event.id,
        event.at,
        event.type,
        JSON.stringify(event),
        event.seq ?? null,
        event.by.kind === "user" ? event.by.deviceId : null,
        Date.now(),
      );
    }
  });
  const all = await loadAllEvents();
  const folded = foldEvents(all);
  await upsertEntities(folded);
  return folded;
}

/** Export every event as JSONL (one object per line). */
export async function exportEventsJsonl(): Promise<string> {
  const events = await loadAllEvents();
  return events.map((event) => encodeEvent(event).trimEnd()).join("\n") + (events.length ? "\n" : "");
}

/** Wipe local log and entity cache (sign-out / delete account). Keeps deviceId. */
export async function wipeLocalData(): Promise<void> {
  const database = await openDatabase();
  const deviceId = await getSyncMeta(DEVICE_ID_META_KEY);
  await database.execAsync(`
    DELETE FROM events;
    DELETE FROM entities;
    DELETE FROM sync_meta;
  `);
  if (deviceId) {
    await setSyncMeta(DEVICE_ID_META_KEY, deviceId);
  }
}

export async function getSyncMeta(key: string): Promise<string | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<{ readonly value: string }>(
    `SELECT value FROM sync_meta WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}
