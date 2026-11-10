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
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

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
import { ensureWebStorageOwner, getDatabaseRuntime } from "./runtime";

const DEVICE_ID_META_KEY = "deviceId";
const runtime = getDatabaseRuntime();

/** Serialize every local journal mutation across snapshot, commit, and cache work. */
export async function withLocalWriteLock<A>(
  task: (databaseName: string) => Promise<A>,
): Promise<A> {
  const databaseName = runtime.activeDatabaseName;
  const previous = runtime.writeTail;
  let release!: () => void;
  runtime.writeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task(databaseName);
  } finally {
    release();
  }
}

/**
 * Exclusive transactions are native-only on expo-sqlite.
 * Web falls back to a regular transaction so the Expo web preview can hydrate.
 */
async function runExclusive(
  database: SQLiteDatabase,
  task: (tx: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  const useWebTx =
    Platform.OS === "web" || typeof database.withExclusiveTransactionAsync !== "function";
  if (useWebTx) {
    await database.withTransactionAsync(async () => {
      await task(database);
    });
    return;
  }
  try {
    await database.withExclusiveTransactionAsync(task);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("withExclusiveTransactionAsync is not supported on web")
    ) {
      await database.withTransactionAsync(async () => {
        await task(database);
      });
      return;
    }
    throw error;
  }
}

/** Open (or reuse) the local Yatma database and migrate schema. */
export async function openDatabase(
  databaseName = runtime.activeDatabaseName,
): Promise<SQLiteDatabase> {
  let databasePromise = runtime.databases.get(databaseName);
  if (!databasePromise) {
    // Expo initializes one VFS per worker, even across different account files.
    // Serialize first opens so concurrent consumers cannot initialize it twice.
    databasePromise = runtime.openTail.then(() => initDatabase(databaseName));
    runtime.openTail = databasePromise.then(
      () => {},
      () => {},
    );
    runtime.databases.set(databaseName, databasePromise);
    const pending = databasePromise;
    void pending.catch(() => {
      if (runtime.databases.get(databaseName) === pending) runtime.databases.delete(databaseName);
    });
  }
  return databasePromise;
}

async function initDatabase(databaseName: string): Promise<SQLiteDatabase> {
  await ensureWebStorageOwner(runtime);
  const database = await SQLite.openDatabaseAsync(databaseName);
  try {
    await database.execAsync(SCHEMA_SQL);
    const versionRow = await database.getFirstAsync<{ readonly user_version: number }>(
      "PRAGMA user_version",
    );
    const current = versionRow?.user_version ?? 0;
    if (current < DATABASE_SCHEMA_VERSION) {
      await database.execAsync(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`);
    }
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => {});
    throw error;
  }
}

/** Select an account-specific database while serializing with pending local writes. */
export async function selectLocalAccount(accountId: string | null): Promise<void> {
  const request = ++runtime.accountSelectionGeneration;
  const databaseName = accountId
    ? `yatma-${(
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, accountId)
      ).slice(0, 32)}.db`
    : DATABASE_NAME;
  if (request !== runtime.accountSelectionGeneration) return;
  runtime.activeDatabaseName = databaseName;
  await withLocalWriteLock(async (selectedName) => {
    await openDatabase(selectedName);
  });
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
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    await database.runAsync(
      `INSERT INTO events (id, at, type, payload, seq, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.at,
      event.type,
      eventPayload(event),
      event.seq ?? null,
      event.by.kind === "user" ? event.by.deviceId : null,
      Date.now(),
    );
  });
}

/** Upsert folded entity snapshots (full replace of known kinds). */
export async function upsertEntities(folded: FoldedEntities): Promise<void> {
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    await runExclusive(database, async (tx) => writeEntityRows(tx, folded));
  });
}

/** Upsert a single entity row from folded state. */
export async function upsertEntity(
  kind: EntityKind,
  id: string,
  payload: unknown,
  updatedAt: string,
): Promise<void> {
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    await database.runAsync(
      `INSERT INTO entities (kind, id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      kind,
      id,
      JSON.stringify(payload),
      updatedAt,
    );
  });
}

/** Append an event and refresh the entity cache from the new fold. */
export async function appendEventAndUpsert(
  event: Event,
  _previous: FoldedEntities,
): Promise<FoldedEntities> {
  return commitLocalBatch([event]);
}

/** Commit a validated local batch and the projections rebuilt from it atomically. */
export async function commitLocalBatch(events: readonly Event[]): Promise<FoldedEntities> {
  return withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    let next!: FoldedEntities;
    await runExclusive(database, async (tx) => {
      const eventRows = await tx.getAllAsync<EventRow>(
        `SELECT id, at, type, payload, seq, device_id, created_at FROM events ORDER BY at ASC, id ASC`,
      );
      const existing: Event[] = [];
      for (const row of eventRows) {
        const parsed = parseEventLine(row.payload);
        if (parsed.ok) existing.push(eventWithSequence(parsed.event, row.seq));
      }
      const byId = new Map(existing.map((event) => [event.id, event]));
      const newEvents: Event[] = [];
      for (const event of events) {
        const previousEvent = byId.get(event.id);
        if (previousEvent) {
          if (!sameEventContent(previousEvent, event))
            throw new Error(`event conflict: ${event.id}`);
          continue;
        }
        byId.set(event.id, event);
        newEvents.push(event);
      }
      next = foldEvents([...existing, ...newEvents]);
      for (const event of newEvents) {
        await tx.runAsync(
          `INSERT INTO events (id, at, type, payload, seq, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.at,
          event.type,
          eventPayload(event),
          event.seq ?? null,
          event.by.kind === "user" ? event.by.deviceId : null,
          Date.now(),
        );
      }
      const projectionRows = entityRowsFromFolded(next);
      for (const row of projectionRows) {
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
  });
}

function eventPayload(event: Event): string {
  const { seq: _sequence, ...content } = event;
  return JSON.stringify(content);
}

function eventWithSequence(event: Event, sequence: number | null): Event {
  const { seq: _embeddedSequence, ...content } = event;
  return sequence === null ? (content as Event) : ({ ...content, seq: sequence } as Event);
}

function sameEventContent(left: Event, right: Event): boolean {
  const { seq: _leftSeq, ...leftContent } = left;
  const { seq: _rightSeq, ...rightContent } = right;
  return canonicalJson(leftContent) === canonicalJson(rightContent);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Load cached entity maps, or null when the cache is empty. */
export async function loadCachedEntities(databaseName?: string): Promise<CachedEntityMaps | null> {
  const database = await openDatabase(databaseName);
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

export type LocalCursorUpdate = { readonly key: string; readonly after: number };

/**
 * Cold start: prefer entity cache when present, otherwise fold the event log.
 * Backfills the cache when folding from events.
 */
export async function hydrateLocalState(): Promise<HydratedLocalState> {
  return withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    const meta = await database.getFirstAsync<{ readonly value: string }>(
      `SELECT value FROM sync_meta WHERE key = ?`,
      DEVICE_ID_META_KEY,
    );
    const storedDeviceId = meta?.value ?? null;
    const deviceId = storedDeviceId ?? createDeviceId();
    if (!storedDeviceId) {
      await database.runAsync(
        `INSERT INTO sync_meta (key, value) VALUES (?, ?)`,
        DEVICE_ID_META_KEY,
        deviceId,
      );
    }
    const events = await loadAllEvents(databaseName);
    const cached = await loadCachedEntities(databaseName);
    if (cached) {
      return {
        folded: foldedFromCache(cached, events),
        deviceId,
        lastSeenAt: lastSeenAtFromEvents(events),
      };
    }
    const folded = foldEvents(events);
    if (events.length > 0) {
      await runExclusive(database, async (tx) => writeEntityRows(tx, folded));
    }
    return { folded, deviceId, lastSeenAt: lastSeenAtFromEvents(events) };
  });
}

/** Load all events ordered for folding. */
export async function loadAllEvents(databaseName?: string): Promise<Event[]> {
  const database = await openDatabase(databaseName);
  const rows = await database.getAllAsync<EventRow>(
    `SELECT id, at, type, payload, seq, device_id, created_at
     FROM events
     ORDER BY at ASC, id ASC`,
  );
  const events: Event[] = [];
  for (const row of rows) {
    const parsed = parseEventLine(row.payload);
    if (parsed.ok) events.push(eventWithSequence(parsed.event, row.seq));
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
    if (parsed.ok) events.push(eventWithSequence(parsed.event, row.seq));
  }
  return events;
}

/** Stamp server sequence onto a previously local event. */
export async function assignEventSeq(eventId: string, seq: number): Promise<void> {
  await acknowledgeEvents([{ id: eventId, seq }]);
}

/** Add authoritative sequence assignments without changing immutable event content. */
export async function acknowledgeEvents(
  assignments: readonly { readonly id: string; readonly seq: number }[],
): Promise<void> {
  for (const assignment of assignments) {
    if (!Number.isSafeInteger(assignment.seq) || assignment.seq <= 0) {
      throw new Error(`invalid sequence assignment for event ${assignment.id}`);
    }
  }
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    await runExclusive(database, async (tx) => {
      for (const assignment of assignments) {
        const row = await tx.getFirstAsync<EventRow>(
          `SELECT id, at, type, payload, seq, device_id, created_at FROM events WHERE id = ?`,
          assignment.id,
        );
        if (!row) continue;
        if (row.seq !== null && row.seq !== assignment.seq) {
          throw new Error(`sequence conflict for event ${assignment.id}`);
        }
        const parsed = parseEventLine(row.payload);
        if (!parsed.ok) throw new Error(`invalid stored event ${assignment.id}`);
        await tx.runAsync(`UPDATE events SET seq = ? WHERE id = ?`, assignment.seq, assignment.id);
      }
    });
  });
}

/** Merge remote events (idempotent by id) and refresh entity cache. */
export async function upsertRemoteEvents(events: readonly Event[]): Promise<FoldedEntities> {
  return mergeRemoteBatch(events);
}

/** Atomically merge remote rows, rebuild projections, and optionally advance the cursor. */
export async function mergeRemoteBatch(
  events: readonly Event[],
  cursor?: LocalCursorUpdate,
): Promise<FoldedEntities> {
  if (cursor && (!Number.isSafeInteger(cursor.after) || cursor.after < 0)) {
    throw new Error("invalid remote cursor");
  }
  for (const event of events) {
    if (event.seq !== undefined && (!Number.isSafeInteger(event.seq) || event.seq <= 0)) {
      throw new Error(`invalid sequence for event ${event.id}`);
    }
  }
  return withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    let folded!: FoldedEntities;
    await runExclusive(database, async (tx) => {
      for (const event of events) {
        const stored = await tx.getFirstAsync<EventRow>(
          `SELECT id, at, type, payload, seq, device_id, created_at FROM events WHERE id = ?`,
          event.id,
        );
        if (stored) {
          const parsed = parseEventLine(stored.payload);
          if (!parsed.ok || !sameEventContent(parsed.event, event)) {
            throw new Error(`event conflict: ${event.id}`);
          }
          if (stored.seq !== null && event.seq !== undefined && stored.seq !== event.seq) {
            throw new Error(`sequence conflict for event ${event.id}`);
          }
          const sequence = event.seq ?? stored.seq;
          await tx.runAsync(`UPDATE events SET seq = ? WHERE id = ?`, sequence ?? null, event.id);
        } else {
          await tx.runAsync(
            `INSERT INTO events (id, at, type, payload, seq, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            event.id,
            event.at,
            event.type,
            eventPayload(event),
            event.seq ?? null,
            event.by.kind === "user" ? event.by.deviceId : null,
            Date.now(),
          );
        }
      }
      const rows = await tx.getAllAsync<EventRow>(
        `SELECT id, at, type, payload, seq, device_id, created_at FROM events ORDER BY at ASC, id ASC`,
      );
      const all: Event[] = [];
      for (const row of rows) {
        const parsed = parseEventLine(row.payload);
        if (parsed.ok) all.push(eventWithSequence(parsed.event, row.seq));
      }
      folded = foldEvents(all);
      await writeEntityRows(tx, folded);
      if (cursor) {
        const current = await tx.getFirstAsync<{ readonly value: string }>(
          `SELECT value FROM sync_meta WHERE key = ?`,
          cursor.key,
        );
        const currentAfter = Number(current?.value ?? 0);
        await tx.runAsync(
          `INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          cursor.key,
          String(Math.max(Number.isFinite(currentAfter) ? currentAfter : 0, cursor.after)),
        );
      }
    });
    return folded;
  });
}

async function writeEntityRows(tx: SQLiteDatabase, folded: FoldedEntities): Promise<void> {
  for (const row of entityRowsFromFolded(folded)) {
    await tx.runAsync(
      `INSERT INTO entities (kind, id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      row.kind,
      row.id,
      row.payload,
      row.updatedAt,
    );
  }
}

/** Export every event as JSONL (one object per line). */
export async function exportEventsJsonl(): Promise<string> {
  const events = await loadAllEvents();
  return (
    events.map((event) => encodeEvent(event).trimEnd()).join("\n") + (events.length ? "\n" : "")
  );
}

/** Wipe the selected account's local log and cache. Keeps its device and dictation preference. */
export async function wipeLocalData(): Promise<void> {
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    const deviceRow = await database.getFirstAsync<{ readonly value: string }>(
      `SELECT value FROM sync_meta WHERE key = ?`,
      DEVICE_ID_META_KEY,
    );
    const autoSendRow = await database.getFirstAsync<{ readonly value: string }>(
      `SELECT value FROM sync_meta WHERE key = ?`,
      "preference.autoSendDictation",
    );
    const deviceId = deviceRow?.value ?? null;
    const autoSendDictation = autoSendRow?.value ?? null;
    await runExclusive(database, async (tx) => {
      await tx.runAsync(`DELETE FROM events`);
      await tx.runAsync(`DELETE FROM entities`);
      await tx.runAsync(`DELETE FROM sync_meta`);
      if (deviceId) {
        await tx.runAsync(
          `INSERT INTO sync_meta (key, value) VALUES (?, ?)`,
          DEVICE_ID_META_KEY,
          deviceId,
        );
      }
      if (autoSendDictation !== null) {
        await tx.runAsync(
          `INSERT INTO sync_meta (key, value) VALUES (?, ?)`,
          "preference.autoSendDictation",
          autoSendDictation,
        );
      }
    });
  });
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
  await withLocalWriteLock(async (databaseName) => {
    const database = await openDatabase(databaseName);
    await database.runAsync(
      `INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  });
}
