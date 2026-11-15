import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import type { Event } from "@yatma/core";
import { DeviceId, EventId, TaskId, emptyFolded, reviewItemId } from "@yatma/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ databases: new Map<string, unknown>() }));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => testState.databases.get(name),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) => `hash-${value}`,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

let db: ReturnType<typeof makeAdapter>;
let api: typeof import("./database");

function makeAdapter() {
  const raw = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (sql: string) => raw.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).run(...(params as never[])),
    getFirstAsync: async <T>(sql: string, ...params: unknown[]) =>
      raw.prepare(sql).get(...(params as never[])) as T | undefined,
    getAllAsync: async <T>(sql: string, ...params: unknown[]) =>
      raw.prepare(sql).all(...(params as never[])) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec("BEGIN");
      try {
        await task();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    withExclusiveTransactionAsync: async (task: (tx: SQLiteDatabase) => Promise<void>) => {
      raw.exec("BEGIN");
      try {
        await task(adapter as unknown as SQLiteDatabase);
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { raw, adapter };
}

const actor = { kind: "user" as const, deviceId: DeviceId.make("device-test") };
function taskEvent(id: number, title: string, seq?: number): Event {
  return {
    v: 1,
    id: EventId.make(id.toString(32).toUpperCase().padStart(26, "0")),
    at: `2026-10-15T00:00:${String(id).padStart(2, "0")}.000Z`,
    by: actor,
    type: "task.created",
    taskId: TaskId.make(`t_${id.toString(32).toUpperCase().padStart(8, "A")}`),
    projectId: null,
    title,
    status: "todo",
    quadrant: null,
    position: `p${id}`,
    ...(seq === undefined ? {} : { seq }),
  };
}

function dailyFixture(): readonly Event[] {
  const at = "2026-10-15T01:00:00.000Z";
  const base = { v: 1 as const, at, by: actor };
  const id = (seed: string) => EventId.make(seed.padStart(26, "0"));
  return [
    {
      ...base,
      id: id("D1"),
      type: "day.created",
      day: {
        id: "day-a",
        date: "2026-10-15",
        timezone: "Pacific/Auckland",
        assembled: true,
        suppressedBreakOrigins: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    {
      ...base,
      id: id("D2"),
      type: "dayEntry.created",
      entry: {
        id: "entry-a",
        dayId: "day-a",
        kind: "task",
        taskId: TaskId.make("t_AAAAAAA1"),
        title: "Today's work",
        allocationMinutes: 30,
        position: "a",
        status: "pending",
        origin: "task:t_AAAAAAA1",
        manual: false,
        carryOrder: null,
        preparation: false,
        resumeEntryId: null,
        createdAt: at,
        updatedAt: at,
      },
    },
    {
      ...base,
      id: id("D3"),
      type: "workInterval.created",
      interval: {
        id: "interval-a",
        dayId: "day-a",
        entryId: "entry-a",
        deviceId: actor.deviceId,
        startedAt: at,
        endedAt: null,
        correctedSeconds: null,
        updatedAt: at,
      },
    },
    {
      ...base,
      id: id("D4"),
      type: "stackTemplate.saved",
      template: {
        id: "routine",
        version: 1,
        title: "Routine",
        items: [{ key: "prepare", kind: "activity", title: "Prepare", allocationMinutes: 5 }],
        updatedAt: at,
      },
    },
    {
      ...base,
      id: id("D5"),
      type: "stackPreferences.updated",
      set: { scene: "rain", workIntervalMinutes: 90 },
    },
  ];
}

beforeAll(async () => {
  db = makeAdapter();
  testState.databases.set("yatma.db", db.adapter);
  api = await import("./database");
});

beforeEach(async () => {
  await api.selectLocalAccount(null);
  await api.openDatabase();
  db.raw.exec("DELETE FROM events; DELETE FROM entities; DELETE FROM sync_meta;");
  db.raw.exec("DROP TRIGGER IF EXISTS fail_entity_write;");
});

describe("local journal transactions", () => {
  it("stores review decisions in the journal and cache across reload and duplicate sync", async () => {
    const at = "2026-11-11T00:00:00.000Z";
    const itemId = reviewItemId("gmail", "mail:1");
    const received: Event = {
      v: 1,
      id: EventId.make("000000000000000000000000R1"),
      at,
      by: actor,
      type: "review.received",
      item: {
        id: itemId,
        taskId: null,
        source: "gmail",
        sourceId: "mail:1",
        sourceRevision: "1",
        title: "Client request",
        sourceText: "Please review",
        sourceUrl: "https://mail.google.com/",
        receivedAt: at,
        updatedAt: at,
        disposition: "pending",
        reason: null,
        revisitOn: null,
        seenAt: null,
      },
    };
    const decided: Event = {
      v: 1,
      id: EventId.make("000000000000000000000000R2"),
      at: "2026-11-11T00:00:01.000Z",
      by: actor,
      type: "review.updated",
      itemId,
      set: { disposition: "later", reason: "Need the brief", revisitOn: "2026-11-13" },
      prev: { disposition: "pending", reason: null, revisitOn: null },
    };
    await api.commitLocalBatch([received, decided]);
    const cached = await api.loadCachedEntities();
    expect(cached?.reviewItems.get(itemId)).toMatchObject({
      disposition: "later",
      revisitOn: "2026-11-13",
    });
    await api.upsertRemoteEvents([received, decided]);
    const reloaded = await api.hydrateLocalState();
    expect(reloaded.folded.reviewItems.size).toBe(1);
    expect(reloaded.folded.reviewItems.get(itemId)?.reason).toBe("Need the brief");
    expect(reloaded.folded.tasks.size).toBe(0);
    expect(reloaded.folded.dayEntries.size).toBe(0);
  });

  it("commits and hydrates every daily record kind without creating backlog tasks", async () => {
    const events = dailyFixture();
    await api.commitLocalBatch(events);
    await api.commitLocalBatch(events);
    const hydrated = await api.hydrateLocalState();
    expect(hydrated.folded.days.get("day-a")?.timezone).toBe("Pacific/Auckland");
    expect(hydrated.folded.dayEntries.get("entry-a")?.allocationMinutes).toBe(30);
    expect(hydrated.folded.workIntervals.get("interval-a")?.endedAt).toBeNull();
    expect(hydrated.folded.stackTemplates.get("routine")?.items).toHaveLength(1);
    expect(hydrated.folded.stackPreferences.get("default")?.scene).toBe("rain");
    expect(hydrated.folded.tasks.size).toBe(0);
    expect(await api.loadAllEvents()).toHaveLength(5);
    const kinds = db.raw
      .prepare("SELECT kind FROM entities ORDER BY kind")
      .all()
      .map((row) => row.kind);
    expect(kinds).toEqual(["day", "dayEntry", "stackPreferences", "stackTemplate", "workInterval"]);
  });

  it("retains a manual allocation after a later concurrent assembly reaches the same entry", async () => {
    const fixture = dailyFixture();
    await api.commitLocalBatch(fixture);
    const original = fixture.find((event) => event.type === "dayEntry.created");
    if (original?.type !== "dayEntry.created") throw new Error("missing fixture entry");
    const update: Event = {
      v: 1,
      id: EventId.make("000000000000000000000000F1"),
      at: "2026-10-15T01:01:00.000Z",
      by: actor,
      type: "dayEntry.updated",
      entryId: original.entry.id,
      set: { allocationMinutes: 45, manual: true },
    };
    const lateCreation: Event = {
      ...original,
      id: EventId.make("000000000000000000000000F2"),
      at: "2026-10-15T01:02:00.000Z",
      entry: { ...original.entry, allocationMinutes: 15 },
    };
    await api.mergeRemoteBatch([lateCreation, update], { key: "after", after: 22 });
    const hydrated = await api.hydrateLocalState();
    expect(hydrated.folded.dayEntries.size).toBe(1);
    expect(hydrated.folded.dayEntries.get(original.entry.id)).toMatchObject({
      allocationMinutes: 45,
      manual: true,
    });
  });

  it("rolls back an entire day transfer and interval close when a projection fails", async () => {
    const source = dailyFixture();
    await api.commitLocalBatch(source);
    const at = "2026-10-15T01:10:00.000Z";
    const base = { v: 1 as const, at, by: actor };
    const entryCreated = source.find((event) => event.type === "dayEntry.created");
    if (entryCreated?.type !== "dayEntry.created") throw new Error("missing fixture entry");
    const transfer: readonly Event[] = [
      {
        ...base,
        id: EventId.make("000000000000000000000000E1"),
        type: "day.created",
        day: {
          id: "day-b",
          date: "2026-10-16",
          timezone: "Pacific/Auckland",
          assembled: false,
          suppressedBreakOrigins: [],
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        ...base,
        id: EventId.make("000000000000000000000000E2"),
        type: "dayEntry.updated",
        entryId: "entry-a",
        set: { status: "deferred" },
      },
      {
        ...base,
        id: EventId.make("000000000000000000000000E3"),
        type: "workInterval.updated",
        intervalId: "interval-a",
        set: { endedAt: at },
      },
      {
        ...base,
        id: EventId.make("000000000000000000000000E4"),
        type: "dayEntry.created",
        entry: {
          ...entryCreated.entry,
          id: "entry-b",
          dayId: "day-b",
          allocationMinutes: 20,
          carryOrder: at,
          createdAt: at,
          updatedAt: at,
        },
      },
    ];
    db.raw.exec(`CREATE TRIGGER fail_entity_write BEFORE INSERT ON entities
      BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END;`);
    await expect(api.mergeRemoteBatch(transfer, { key: "after", after: 30 })).rejects.toThrow();
    expect(await api.loadAllEvents()).toHaveLength(5);
    expect(await api.getSyncMeta("after")).toBeNull();
    const unchanged = await api.hydrateLocalState();
    expect(unchanged.folded.dayEntries.get("entry-a")?.status).toBe("pending");
    expect(unchanged.folded.workIntervals.get("interval-a")?.endedAt).toBeNull();
    expect(unchanged.folded.days.has("day-b")).toBe(false);

    db.raw.exec("DROP TRIGGER fail_entity_write");
    await api.mergeRemoteBatch(transfer, { key: "after", after: 30 });
    const committed = await api.hydrateLocalState();
    expect(committed.folded.dayEntries.get("entry-a")?.status).toBe("deferred");
    expect(committed.folded.workIntervals.get("interval-a")?.endedAt).toBe(at);
    expect(committed.folded.dayEntries.get("entry-b")?.allocationMinutes).toBe(20);
  });

  it("isolates each account database and retains its data when switching", async () => {
    for (const name of ["yatma-hash-account-a.db", "yatma-hash-account-b.db"]) {
      const accountDb = makeAdapter();
      testState.databases.set(name, accountDb.adapter);
    }
    await api.selectLocalAccount("account-a");
    await api.appendEvent(taskEvent(6, "Account A"));
    await api.selectLocalAccount("account-b");
    expect(await api.loadAllEvents()).toHaveLength(0);
    await api.appendEvent(taskEvent(7, "Account B"));
    await api.selectLocalAccount("account-a");
    expect(
      (await api.loadAllEvents()).map((event) =>
        event.type === "task.created" ? event.title : "",
      ),
    ).toEqual(["Account A"]);
    await api.selectLocalAccount(null);
    expect(await api.loadAllEvents()).toHaveLength(0);
  });

  it("wipes only the selected account database", async () => {
    for (const name of ["yatma-hash-delete-a.db", "yatma-hash-delete-b.db"]) {
      const accountDb = makeAdapter();
      testState.databases.set(name, accountDb.adapter);
    }
    await api.selectLocalAccount("delete-a");
    await api.appendEvent(taskEvent(8, "Delete A"));
    await api.selectLocalAccount("delete-b");
    await api.appendEvent(taskEvent(9, "Keep B"));
    await api.selectLocalAccount("delete-a");
    await api.wipeLocalData();
    expect(await api.loadAllEvents()).toHaveLength(0);
    await api.selectLocalAccount("delete-b");
    expect(
      (await api.loadAllEvents()).map((event) =>
        event.type === "task.created" ? event.title : "",
      ),
    ).toEqual(["Keep B"]);
  });

  it("serializes overlapping local commits from stale snapshots", async () => {
    const first = taskEvent(1, "First");
    const second = taskEvent(2, "Second");
    await Promise.all([
      api.appendEventAndUpsert(first, emptyFolded()),
      api.appendEventAndUpsert(second, emptyFolded()),
    ]);

    const loaded = await api.loadAllEvents();
    const hydrated = await api.hydrateLocalState();
    expect(loaded.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(hydrated.folded.tasks.size).toBe(2);
  });

  it("deduplicates identical remote IDs and rejects conflicting historical content", async () => {
    const event = taskEvent(3, "Remote", 11);
    await api.mergeRemoteBatch([event], { key: "after", after: 11 });
    await expect(api.mergeRemoteBatch([event], { key: "after", after: 11 })).resolves.toBeDefined();
    await expect(
      api.mergeRemoteBatch([taskEvent(3, "Conflict", 11)], { key: "after", after: 12 }),
    ).rejects.toThrow(/event conflict/);
    expect(await api.loadAllEvents()).toHaveLength(1);
    expect(await api.getSyncMeta("after")).toBe("11");
  });

  it("rolls back remote rows and cursor when projection writes fail, and keeps cursor monotonic", async () => {
    db.raw.exec(`CREATE TRIGGER fail_entity_write BEFORE INSERT ON entities
      BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END;`);
    const event = taskEvent(4, "Atomic", 14);
    await expect(api.mergeRemoteBatch([event], { key: "after", after: 14 })).rejects.toThrow();
    expect(await api.loadAllEvents()).toHaveLength(0);
    expect(await api.getSyncMeta("after")).toBeNull();

    db.raw.exec("DROP TRIGGER fail_entity_write;");
    await api.mergeRemoteBatch([event], { key: "after", after: 14 });
    await api.mergeRemoteBatch([], { key: "after", after: 9 });
    expect(await api.getSyncMeta("after")).toBe("14");
  });

  it("acknowledges idempotently without changing payload content", async () => {
    const event = taskEvent(5, "Outbox");
    await api.appendEventAndUpsert(event, emptyFolded());
    const payloadBefore = db.raw
      .prepare("SELECT payload FROM events WHERE id = ?")
      .get(event.id) as { payload: string };
    await api.acknowledgeEvents([{ id: event.id, seq: 15 }]);
    await api.acknowledgeEvents([{ id: event.id, seq: 15 }]);
    const payloadAfter = db.raw
      .prepare("SELECT payload FROM events WHERE id = ?")
      .get(event.id) as { payload: string };
    expect(payloadAfter.payload).toBe(payloadBefore.payload);
    expect((await api.loadAllEvents())[0]?.seq).toBe(15);
    await expect(api.acknowledgeEvents([{ id: event.id, seq: 16 }])).rejects.toThrow(
      /sequence conflict/,
    );
  });

  it("rejects unsupported remote events without writing rows or advancing the cursor", async () => {
    const unsupported = {
      ...taskEvent(10, "Future", 20),
      type: "future.created",
    } as unknown as Event;
    await expect(api.mergeRemoteBatch([unsupported], { key: "after", after: 20 })).rejects.toThrow(
      /Unsupported or invalid incoming event/,
    );
    expect(await api.loadAllEvents()).toEqual([]);
    expect(await api.getSyncMeta("after")).toBeNull();
  });

  it("fails hydration and later commits when persisted journal records cannot be read", async () => {
    const event = taskEvent(11, "Future");
    const payload = JSON.stringify({ ...event, type: "future.created" });
    db.raw
      .prepare(
        "INSERT INTO events (id, at, type, payload, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(event.id, event.at, "future.created", payload, 21, 0);
    await expect(api.hydrateLocalState()).rejects.toThrow(/Unsupported or invalid stored event/);
    await expect(api.commitLocalBatch([taskEvent(12, "Must not commit")])).rejects.toThrow(
      /Unsupported or invalid stored event/,
    );
    expect(db.raw.prepare("SELECT COUNT(*) AS total FROM events").get()).toMatchObject({
      total: 1,
    });
    expect(db.raw.prepare("SELECT COUNT(*) AS total FROM entities").get()).toMatchObject({
      total: 0,
    });
  });
});

it("round-trips checklist strings and completion through SQLite, cache and replay", async () => {
  const created = taskEvent(20, "Checklist task");
  if (created.type !== "task.created") throw new Error("Expected task fixture");
  const todos = [{ text: "One plain item", done: true }];
  const updated: Event = {
    v: 1,
    id: EventId.make("000000000000000000000000T1"),
    at: "2026-11-11T00:00:00.000Z",
    by: actor,
    type: "task.updated",
    taskId: created.taskId,
    set: { todos },
    prev: { todos: [] },
  };
  await api.commitLocalBatch([created, updated]);
  expect((await api.loadCachedEntities())?.tasks.get(created.taskId)?.todos).toEqual(todos);
  const reloaded = await api.hydrateLocalState();
  expect(reloaded.folded.tasks.get(created.taskId)?.todos).toEqual(todos);
  expect(reloaded.folded.tasks.size).toBe(1);
});
