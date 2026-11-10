import type { DeviceId, Event, PingResult, SyncBatch } from "@yatma/core";

import {
  acknowledgeEvents,
  getSyncMeta,
  loadOutboxEvents,
} from "../db/database";
import { createSyncClient, type SyncClient, type SyncClientStatus } from "./client";

const CURSOR_KEY = "after";
const OUTBOX_RETRY_MS = 15_000;

export type SyncEngineOptions = {
  readonly url: string;
  readonly getToken: () => Promise<string | null>;
  readonly deviceId: string;
  readonly onStatus: (status: SyncClientStatus) => void;
  readonly mergeRemoteEvents: (
    events: readonly Event[],
    cursor?: { readonly key: string; readonly after: number },
  ) => void | Promise<void>;
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

/**
 * Start M2 sync: connect → ping → subscribe(after) → flush outbox; retry on interval.
 */
export function startSyncEngine(options: SyncEngineOptions): SyncEngine {
  activeEngine?.stop();

  let stopped = false;
  let flushing = false;
  let booting = false;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

  async function applyBatch(batch: SyncBatch): Promise<void> {
    if (stopped) return;
    await options.mergeRemoteEvents(batch.events, { key: CURSOR_KEY, after: batch.after });
  }

  const client = createSyncClient({
    url: options.url,
    getToken: options.getToken,
    onStatus: (status) => {
      options.onStatus(status);
    },
    onSyncBatch: applyBatch,
  });

  async function flushOutbox(): Promise<void> {
    if (stopped || flushing) return;
    flushing = true;
    try {
      const events = await loadOutboxEvents();
      if (stopped || events.length === 0) return;
      const result = await client.push({
        events,
        deviceId: options.deviceId as DeviceId,
      });
      if (stopped) return;
      await acknowledgeEvents(result.assigned);
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
      reconnectAttempt = 0;
      await client.ping();
      if (stopped) return;
      const after = await readCursor();
      if (stopped) return;
      const subscription = client.subscribe(after);
      await subscription.ready;
      if (stopped) return;
      void subscription.completion.then(
        () => scheduleReconnect(),
        () => scheduleReconnect(),
      );
      await flushOutbox();
    } finally {
      booting = false;
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(2_000 * 2 ** reconnectAttempt, 60_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) {
        void boot().catch(() => {
          options.onStatus("error");
          scheduleReconnect();
        });
      }
    }, delay);
  }

  void boot().catch(() => {
    options.onStatus("error");
    scheduleReconnect();
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
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      client.disconnect();
      if (activeEngine === engine) activeEngine = null;
    },
  };

  activeEngine = engine;
  return engine;
}
