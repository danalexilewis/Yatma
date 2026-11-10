import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import type { Event } from "@yatma/core";
import { DeviceId, EventId, TaskId, emptyFolded } from "@yatma/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ databases: new Map<string, unknown>() }));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async (name: string) => testState.databases.get(name) }));
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
    expect((await api.loadAllEvents()).map((event) => event.type === "task.created" ? event.title : "")).toEqual(["Account A"]);
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
    expect((await api.loadAllEvents()).map((event) => event.type === "task.created" ? event.title : "")).toEqual(["Keep B"]);
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
});
