import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { openDatabaseAsync, platform } = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
  platform: { OS: "ios" },
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));
vi.mock("expo-crypto", () => ({}));
vi.mock("react-native", () => ({ Platform: platform }));

beforeEach(() => {
  vi.resetModules();
  openDatabaseAsync.mockReset();
  platform.OS = "ios";
  Reflect.deleteProperty(globalThis, "__yatmaDatabaseRuntime");
});

afterEach(() => vi.unstubAllGlobals());

function connection() {
  return {
    execAsync: vi.fn().mockResolvedValue(undefined),
    getFirstAsync: vi.fn().mockResolvedValue({ user_version: 1 }),
    closeAsync: vi.fn().mockResolvedValue(undefined),
  };
}

describe("database initialization", () => {
  it("retries after an open failure instead of permanently caching the rejection", async () => {
    const database = connection();
    openDatabaseAsync
      .mockRejectedValueOnce(new Error("File held by another tab"))
      .mockResolvedValueOnce(database);
    const api = await import("./database");
    await expect(api.openDatabase()).rejects.toThrow("File held by another tab");
    await expect(api.openDatabase()).resolves.toBe(database);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("closes a connection after schema initialization fails and allows recovery", async () => {
    const failed = connection();
    failed.execAsync.mockRejectedValueOnce(new Error("Schema failed"));
    const recovered = connection();
    openDatabaseAsync.mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered);
    const api = await import("./database");
    await expect(api.openDatabase()).rejects.toThrow("Schema failed");
    expect(failed.closeAsync).toHaveBeenCalledTimes(1);
    await expect(api.openDatabase()).resolves.toBe(recovered);
  });

  it("shares same-file opens and serializes VFS initialization across account files", async () => {
    const first = connection();
    let finishSchema!: () => void;
    first.execAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSchema = resolve;
        }),
    );
    const second = connection();
    openDatabaseAsync.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const api = await import("./database");
    const firstOpen = api.openDatabase("first.db");
    const sharedOpen = api.openDatabase("first.db");
    const secondOpen = api.openDatabase("second.db");
    await vi.waitFor(() => expect(first.execAsync).toHaveBeenCalledTimes(1));
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    finishSchema();
    expect(await Promise.all([firstOpen, sharedOpen, secondOpen])).toEqual([first, first, second]);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("rejects a competing web tab before starting SQLite and retries after ownership is available", async () => {
    platform.OS = "web";
    let available = false;
    const request = vi.fn(async (_name, _options, callback) =>
      callback(available ? { name: "yatma:expo-sqlite" } : null),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const database = connection();
    openDatabaseAsync.mockResolvedValue(database);
    const api = await import("./database");

    await expect(api.openDatabase()).rejects.toThrow("another tab");
    expect(openDatabaseAsync).not.toHaveBeenCalled();

    available = true;
    await expect(api.openDatabase()).resolves.toBe(database);
    expect(request).toHaveBeenCalledTimes(2);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it("retains web connections and write serialization across Fast Refresh", async () => {
    platform.OS = "web";
    const request = vi.fn(async (_name, _options, callback) =>
      callback({ name: "yatma:expo-sqlite" }),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const database = connection();
    openDatabaseAsync.mockResolvedValue(database);
    const before = await import("./database");
    await before.openDatabase();

    let releaseWrite!: () => void;
    const pendingWrite = before.withLocalWriteLock(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));
    vi.resetModules();
    const after = await import("./database");
    const nextWrite = vi.fn(async () => {});
    const queuedWrite = after.withLocalWriteLock(nextWrite);
    await expect(after.openDatabase()).resolves.toBe(database);
    expect(nextWrite).not.toHaveBeenCalled();
    releaseWrite();
    await Promise.all([pendingWrite, queuedWrite]);
    expect(nextWrite).toHaveBeenCalledTimes(1);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);

    await after.openDatabase("another-account.db");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps SQLite unopened when the browser cannot coordinate persistent storage", async () => {
    platform.OS = "web";
    vi.stubGlobal("navigator", {});
    const api = await import("./database");
    await expect(api.openDatabase()).rejects.toThrow("Web Locks are unavailable");
    expect(openDatabaseAsync).not.toHaveBeenCalled();
  });
});
