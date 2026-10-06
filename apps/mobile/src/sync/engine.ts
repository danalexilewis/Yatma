import type { DeviceId, Event, PingResult, SyncBatch } from "@yatma/core";

import {
  assignEventSeq,
  getSyncMeta,
  loadOutboxEvents,
  setSyncMeta,
  upsertRemoteEvents,
} from "../db/database";
import { createSyncClient, type SyncClient, type SyncClientStatus } from "./client";

const CURSOR_KEY = "after";
const OUTBOX_RETRY_MS = 15_000;

export type SyncEngineOptions = {
  readonly url: string;
  readonly getToken: () => Promise<string | null>;
  readonly deviceId: string;
  readonly onStatus: (status: SyncClientStatus) => void;
  readonly mergeRemoteEvents: (events: readonly Event[]) => void;
};

export type SyncEngine = {
  readonly stop: () => void;
  readonly ping: () => Promise<PingResult>;
  readonly deleteAccount: () => Promise<{ readonly ok: true }>;
  readonly flushOutbox: () => Promise<void>;
  readonly client: SyncClient;
};

let activeEngine: SyncEngine | null = null;

/** Active sync engine for Settings / debug (null when signed out). */
export function getSyncEngine(): SyncEngine | null {
  return activeEngine;
}

async function readCursor(): Promise<number> {
  const raw = await getSyncMeta(CURSOR_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function writeCursor(after: number): Promise<void> {
  await setSyncMeta(CURSOR_KEY, String(after));
}

/**
 * Start M2 sync: connect → ping → subscribe(after) → flush outbox; retry on interval.
 */
export function startSyncEngine(options: SyncEngineOptions): SyncEngine {
  activeEngine?.stop();

  let stopped = false;
  let flushing = false;
  let booting = false;
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  async function applyBatch(batch: SyncBatch): Promise<void> {
    if (batch.events.length > 0) {
      await upsertRemoteEvents(batch.events);
      options.mergeRemoteEvents(batch.events);
    }
    await writeCursor(batch.after);
  }

  const client = createSyncClient({
    url: options.url,
    getToken: options.getToken,
    onStatus: (status) => {
      options.onStatus(status);
      if (status === "idle" && !stopped) {
        // Reconnect after drop; outbox flush runs again after subscribe.
        setTimeout(() => {
          if (!stopped) void boot().catch(() => {});
        }, 2_000);
      }
    },
    onSyncBatch: (batch) => {
      void applyBatch(batch).catch(() => {});
    },
  });

  async function flushOutbox(): Promise<void> {
    if (stopped || flushing) return;
    flushing = true;
    try {
      const events = await loadOutboxEvents();
      if (events.length === 0) return;
      const result = await client.push({
        events,
        deviceId: options.deviceId as DeviceId,
      });
      for (const row of result.assigned) {
        await assignEventSeq(row.id, row.seq);
      }
    } finally {
      flushing = false;
    }
  }

  async function boot(): Promise<void> {
    if (stopped || booting) return;
    booting = true;
    try {
      await client.connect();
      if (stopped) return;
      await client.ping();
      if (stopped) return;
      const after = await readCursor();
      await client.subscribe(after);
      if (stopped) return;
      await flushOutbox();
    } finally {
      booting = false;
    }
  }

  void boot().catch(() => {
    options.onStatus("error");
  });

  retryTimer = setInterval(() => {
    if (stopped) return;
    void flushOutbox().catch(() => {});
  }, OUTBOX_RETRY_MS);

  const engine: SyncEngine = {
    client,
    flushOutbox,
    ping: () => client.ping(),
    deleteAccount: () => client.deleteAccount(),
    stop: () => {
      stopped = true;
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
      client.disconnect();
      if (activeEngine === engine) activeEngine = null;
    },
  };

  activeEngine = engine;
  return engine;
}
