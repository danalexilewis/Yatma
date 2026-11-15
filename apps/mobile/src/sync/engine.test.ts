import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Event } from "@yatma/core";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadOutboxEvents: vi.fn(),
  acknowledgeEvents: vi.fn(),
  getSyncMeta: vi.fn(),
}));
vi.mock("../db/database", () => ({
  loadOutboxEvents: mocks.loadOutboxEvents,
  acknowledgeEvents: mocks.acknowledgeEvents,
  getSyncMeta: mocks.getSyncMeta,
}));
vi.mock("./client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./client")>();
  return { ...original, createSyncClient: mocks.createClient };
});

import { createSyncClient, type SyncClientStatus } from "./client";
import { getSyncEngine, startSyncEngine } from "./engine";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function harness() {
  const completion = deferred();
  const ready = deferred();
  ready.resolve();
  let callbacks!: Parameters<typeof createSyncClient>[0];
  const client = {
    connect: vi.fn(async () => {
      callbacks.onStatus("connecting");
      callbacks.onStatus("connected");
    }),
    disconnect: vi.fn(() => {
      callbacks.onStatus("idle");
    }),
    ping: vi.fn(async () => ({ ok: true, now: "2026-11-10T00:00:00.000Z" })),
    subscribe: vi.fn(() => ({ ready: ready.promise, completion: completion.promise })),
    push: vi.fn(async () => ({ accepted: [], assigned: [] })),
    deleteAccount: vi.fn(),
  };
  mocks.createClient.mockImplementation((options: Parameters<typeof createSyncClient>[0]) => {
    callbacks = options;
    return client;
  });
  const statuses: SyncClientStatus[] = [];
  const mergeRemoteEvents = vi.fn(async () => {});
  function start() {
    return startSyncEngine({
      url: "ws://localhost",
      getToken: async () => "token",
      deviceId: "device-test",
      onStatus: (status) => {
        statuses.push(status);
      },
      mergeRemoteEvents,
    });
  }
  return {
    client,
    completion,
    ready,
    statuses,
    mergeRemoteEvents,
    start,
    get callbacks() {
      return callbacks;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.getSyncMeta.mockResolvedValue("7");
  mocks.loadOutboxEvents.mockResolvedValue([]);
  mocks.acknowledgeEvents.mockResolvedValue(undefined);
});

afterEach(() => {
  getSyncEngine()?.stop();
  vi.useRealTimers();
});

describe("sync upgrade recovery", () => {
  it("latches an HTTP upgrade rejection without acknowledging outbox data or retrying", async () => {
    const h = harness();
    const localEvent = { id: "pending-event" } as Event;
    mocks.loadOutboxEvents.mockResolvedValue([localEvent]);
    h.client.push.mockRejectedValue({ code: "upgrade_required", message: "Update Yatma" });
    const engine = h.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.statuses.at(-1)).toBe("upgrade_required");
    expect(h.client.push).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledgeEvents).not.toHaveBeenCalled();
    expect(h.mergeRemoteEvents).not.toHaveBeenCalled();
    h.callbacks.onStatus("error");
    h.callbacks.onStatus("idle");
    await vi.advanceTimersByTimeAsync(120_000);
    await engine.flushOutbox();
    expect(h.statuses.at(-1)).toBe("upgrade_required");
    expect(h.client.connect).toHaveBeenCalledTimes(1);
    expect(h.client.push).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.loadOutboxEvents).toHaveBeenCalledTimes(1);
    engine.stop();
    expect(h.statuses.at(-1)).toBe("idle");
  });

  it("preserves the cursor and stops reconnecting after a live RPC upgrade failure", async () => {
    const h = harness();
    h.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.subscribe).toHaveBeenCalledExactlyOnceWith(7);
    h.completion.reject(new Error("upgrade_required"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.statuses.at(-1)).toBe("upgrade_required");
    await vi.advanceTimersByTimeAsync(120_000);
    await h.callbacks.onSyncBatch?.({ events: [], after: 8 });
    expect(h.mergeRemoteEvents).not.toHaveBeenCalled();
    expect(h.client.connect).toHaveBeenCalledTimes(1);
    expect(mocks.getSyncMeta).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("latches a rejected initial subscription before any outbox push", async () => {
    const h = harness();
    const rejectedReady = deferred();
    rejectedReady.reject(
      Object.assign(new Error("Install a current build"), { code: "upgrade_required" }),
    );
    h.client.subscribe.mockReturnValue({
      ready: rejectedReady.promise,
      completion: h.completion.promise,
    });
    h.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.statuses.at(-1)).toBe("upgrade_required");
    expect(h.client.push).not.toHaveBeenCalled();
    expect(mocks.acknowledgeEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.client.connect).toHaveBeenCalledTimes(1);
  });

  it("retains automatic retry for transient connection failures", async () => {
    const h = harness();
    h.client.connect.mockRejectedValueOnce(new Error("network unavailable"));
    h.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.statuses.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.connect).toHaveBeenCalledTimes(2);
    expect(h.statuses.at(-1)).toBe("connected");
    expect(h.client.subscribe).toHaveBeenCalledExactlyOnceWith(7);
  });
});
