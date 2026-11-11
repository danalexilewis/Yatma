/* One dedicated Expo SQLite worker owns OPFS for every tab on this origin.
 * Keep this URL/name stable: existing database files are reused without migration.
 */
const ports = new Set();
const handles = new Map();
const replies = new Map();
let nextId = 1;
let nextHandle = 1;
let worker;
let startup;
let queue = [];
let processing = false;
let transaction;

let owner;
let ready;
let ownership;

function restart() {
  for (const [id, reply] of replies) reply({ id, error: "SQLite host exited; reconnecting." });
  replies.clear();
  worker?.close();
  worker = undefined;
  owner = undefined;
  startup = undefined;
  ready?.();
  ready = undefined;
  queue = [];
  transaction = undefined;
  handles.clear();
  for (const port of ports) port.postMessage({ type: "restart" });
  ports.clear();
}

function start(port) {
  if (startup) return startup;
  owner = port;
  ownership ??= new Promise((resolve, reject) => {
    navigator.locks
      .request("yatma:expo-sqlite", { mode: "exclusive" }, async () => {
        resolve();
        await new Promise(() => {});
      })
      .catch(reject);
  });
  startup = ownership.then(
    () =>
      new Promise((resolve) => {
        if (owner !== port || startup !== opening) {
          resolve();
          return;
        }
        ready = resolve;
        owner.postMessage({ type: "start-worker" });
      }),
  );
  const opening = startup;
  return startup;
}

function releaseClient(port) {
  if (!handles.has(port)) return;
  queue = queue.filter((request) => request.port !== port);
  queue.unshift({ port, message: { type: "disconnect" }, generation: startup });
  void drain();
}

/** Keep other tabs outside an open transaction, including during crash cleanup. */
async function drain() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const index = transaction
        ? queue.findIndex((request) => request.port === transaction.port)
        : 0;
      if (index < 0) break;
      const { port, message, generation } = queue.splice(index, 1)[0];
      try {
        await generation;
        if (generation !== startup || !handles.has(port)) continue;
        if (message.type === "disconnect") {
          if (transaction?.port === port) {
            await invoke({
              type: "exec",
              data: { nativeDatabaseId: transaction.databaseId, source: "ROLLBACK" },
            });
            transaction = undefined;
          }
          for (const [key, id] of handles.get(port)) {
            if (key.startsWith("database:")) {
              await invoke({ type: "close", isSync: false, data: { nativeDatabaseId: id } });
            }
          }
          handles.delete(port);
          ports.delete(port);
          port.close();
          continue;
        }
        const data = remap(port, message.data);
        const result = await invoke({ ...message, data });
        if (!result.error && message.type === "exec") {
          const sql = data.source.trim().replace(/;$/, "").toUpperCase();
          if (/^BEGIN(?:\s|$)/.test(sql)) transaction = { port, databaseId: data.nativeDatabaseId };
          if (/^(COMMIT|END|ROLLBACK)$/.test(sql)) transaction = undefined;
        }
        port.postMessage({ ...result, id: message.id });
      } catch (error) {
        port.postMessage({ id: message.id, error: String(error) });
      }
    }
  } finally {
    processing = false;
  }
}

function remap(port, data) {
  const mapped = { ...data };
  const ids = handles.get(port);
  for (const key of Object.keys(mapped)) {
    if (
      !/^(native(Database|Statement|Session)Id|destNativeDatabaseId|sourceNativeDatabaseId)$/.test(
        key,
      )
    )
      continue;
    const kind = key.includes("Statement")
      ? "statement"
      : key.includes("Session")
        ? "session"
        : "database";
    const local = kind + ":" + mapped[key];
    if (!ids.has(local)) ids.set(local, nextHandle++);
    mapped[key] = ids.get(local);
  }
  return mapped;
}

function invoke(message) {
  return new Promise((resolve) => {
    const id = nextId++;
    replies.set(id, resolve);
    worker.postMessage({ ...message, id });
  });
}

self.onconnect = ({ ports: [port] }) => {
  ports.add(port);
  handles.set(port, new Map());
  port.onmessage = ({ data: message }) => {
    if (message.type === "connect") {
      void start(port).catch(() => {});
      // A Web Lock lease ends even when a tab crashes without sending disconnect.
      void navigator.locks.request(message.lease, () => {
        if (port === owner) restart();
        else releaseClient(port);
      });
      return;
    }
    if (message.type === "worker-failed" && port === owner) {
      for (const [id, reply] of replies)
        reply({ id, error: "SQLite worker failed. Reload to reconnect." });
      replies.clear();
      for (const client of ports)
        client.postMessage({
          type: "failure",
          error: "SQLite worker failed. Reload to reconnect.",
        });
      return;
    }
    if (message.type === "disconnect" && port === owner) {
      ports.delete(port);
      restart();
      return;
    }
    if (message.type === "worker-port") {
      if (port !== owner) return;
      worker = message.port;
      worker.onmessage = ({ data }) => {
        if (data.type === "onDatabaseChange") {
          for (const client of ports) client.postMessage(data);
          return;
        }
        const reply = replies.get(data.id);
        if (reply) {
          replies.delete(data.id);
          reply(data);
        }
      };
      worker.start();
      ready();
      return;
    }
    if (message.type === "disconnect") {
      releaseClient(port);
      return;
    }
    queue.push({ port, message, generation: startup });
    void drain();
  };
  port.start();
};
