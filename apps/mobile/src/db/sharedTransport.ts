/** Bridge Expo's async worker messages to the origin's single SQLite owner. */
export function createSharedSQLiteTransport(url: URL) {
  const shared = new SharedWorker("/sqlite-broker.js", { name: "yatma-sqlite-v1" });
  const listeners = new Set<(event: MessageEvent) => void>();
  const pending = new Map<number, ReturnType<typeof setTimeout>>();
  let dedicated: Worker | undefined;
  let failure: string | undefined;
  function fail(message: string) {
    failure = message;
    for (const [id, timer] of pending) {
      clearTimeout(timer);
      const event = new MessageEvent("message", { data: { id, error: message } });
      for (const listener of listeners) listener(event);
    }
    pending.clear();
  }
  shared.onerror = () => fail("Shared SQLite could not start. Reload to reconnect.");
  shared.port.onmessage = (event: MessageEvent) => {
    if (event.data.type === "start-worker") {
      const base = url.href;
      const source = `
        const base = ${JSON.stringify(base)};
        const originalFetch = fetch;
        const originalImport = importScripts;
        self.fetch = (input, init) => originalFetch(typeof input === "string" ? new URL(input, base).href : input, init);
        self.importScripts = (...urls) => originalImport(...urls.map(url => new URL(url, base).href));
        importScripts(base);
      `;
      const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      dedicated = new Worker(objectUrl);
      URL.revokeObjectURL(objectUrl);
      const channel = new MessageChannel();
      dedicated.postMessage({ type: "yatma:attach", port: channel.port1 }, [channel.port1]);
      shared.port.postMessage({ type: "worker-port", port: channel.port2 }, [channel.port2]);
      dedicated.onerror = () => shared.port.postMessage({ type: "worker-failed" });
      return;
    }
    if (event.data.type === "failure") {
      fail(event.data.error);
      return;
    }
    if (event.data.type === "restart") {
      // The page hosting Expo's dedicated worker exited. Rehydrate committed data.
      window.location.reload();
      return;
    }
    if (event.data.id !== undefined) {
      clearTimeout(pending.get(event.data.id));
      pending.delete(event.data.id);
    }
    for (const listener of listeners) listener(event);
  };
  shared.port.start();
  const lease = "yatma:sqlite-client:" + crypto.randomUUID();
  const connected = new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request(lease, async () => {
        shared.port.postMessage({ type: "connect", lease });
        resolve();
        await new Promise<void>(() => {});
      })
      .catch(reject);
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      shared.port.postMessage({ type: "disconnect" });
      dedicated?.terminate();
      shared.port.close();
    }
  });
  return {
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.add(listener);
    },
    postMessage(message: { id: number; isSync?: boolean }) {
      if (message.isSync)
        throw new Error("Shared SQLite requires asynchronous database operations.");
      if (failure) throw new Error(failure);
      const timer = setTimeout(() => {
        pending.delete(message.id);
        const event = new MessageEvent("message", {
          data: { id: message.id, error: "SQLite did not respond. Reload this tab to reconnect." },
        });
        for (const listener of listeners) listener(event);
      }, 60_000);
      pending.set(message.id, timer);
      void connected
        .then(() => shared.port.postMessage(message))
        .catch(() => fail("Could not coordinate local storage."));
    },
  };
}

const scope = globalThis as typeof globalThis & {
  __yatmaCreateSQLiteWorker?: typeof createSharedSQLiteTransport;
};
if (typeof window !== "undefined" && typeof SharedWorker !== "undefined") {
  scope.__yatmaCreateSQLiteWorker = createSharedSQLiteTransport;
}
