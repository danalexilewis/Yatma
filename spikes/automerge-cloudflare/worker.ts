import { DurableObject } from "cloudflare:workers";
import { EventEmitter } from "eventemitter3";
import {
  Repo,
  cbor,
  type NetworkAdapterInterface,
  type PeerId,
  type Message,
  type PeerMetadata,
  type StorageAdapterInterface,
} from "@automerge/automerge-repo";

type Env = { ROOMS: DurableObjectNamespace<AutomergeRoom>; ASSETS: Fetcher; SPIKE_TOKEN: string };

/** Experimental SQLite adapter, with bounded blobs and explicit prefix matching. */
function storageAdapter(storage: DurableObjectStorage): StorageAdapterInterface {
  const sql = storage.sql;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS am_chunks (k TEXT, part INTEGER, value BLOB, PRIMARY KEY(k, part))",
  );
  const adapter: StorageAdapterInterface = {
    async load(key) {
      const rows = sql
        .exec<{ value: ArrayBuffer }>(
          "SELECT value FROM am_chunks WHERE k = ? ORDER BY part",
          JSON.stringify(key),
        )
        .toArray();
      if (!rows.length) return undefined;
      const size = rows.reduce((total, row) => total + row.value.byteLength, 0);
      const result = new Uint8Array(size);
      let offset = 0;
      for (const row of rows) {
        result.set(new Uint8Array(row.value), offset);
        offset += row.value.byteLength;
      }
      return result;
    },
    async save(key, data) {
      const serialized = JSON.stringify(key);
      storage.transactionSync(() => {
        sql.exec("DELETE FROM am_chunks WHERE k = ?", serialized);
        for (let offset = 0, part = 0; offset < Math.max(data.length, 1); offset += 65536, part++) {
          sql.exec(
            "INSERT INTO am_chunks(k, part, value) VALUES (?, ?, ?)",
            serialized,
            part,
            data.slice(offset, offset + 65536),
          );
        }
      });
    },
    async remove(key) {
      sql.exec("DELETE FROM am_chunks WHERE k = ?", JSON.stringify(key));
    },
    async loadRange(prefix) {
      const keys = sql.exec<{ k: string }>("SELECT DISTINCT k FROM am_chunks").toArray();
      const chunks = [];
      for (const row of keys) {
        const key = JSON.parse(row.k) as string[];
        if (!prefix.every((part, index) => key[index] === part)) continue;
        chunks.push({ key, data: (await adapter.load(key))! });
      }
      return chunks;
    },
    async removeRange(prefix) {
      for (const chunk of await adapter.loadRange(prefix)) await adapter.remove(chunk.key);
    },
  };
  return adapter;
}

/** Cloudflare WebSockets use events and WebSocketPair, rather than Node's ws server. */
function networkAdapter() {
  const sockets = new Map<string, WebSocket>();
  const adapter = Object.assign(new EventEmitter(), {
    peerId: undefined as PeerId | undefined,
    peerMetadata: undefined as PeerMetadata | undefined,
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
      adapter.peerId = peerId;
      adapter.peerMetadata = peerMetadata;
    },
    send(message: Message) {
      sockets.get(message.targetId)?.send(cbor.encode(message));
    },
    disconnect() {
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
    },
  }) satisfies NetworkAdapterInterface;
  function accept(socket: WebSocket) {
    let joinedId: string | null = null;
    socket.accept();
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", async (event) => {
      try {
        if (typeof event.data === "string") throw new Error("binary frames required");
        const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
        const message = cbor.decode(new Uint8Array(data));
        if (message.type === "join") {
          if (
            joinedId ||
            !Array.isArray(message.supportedProtocolVersions) ||
            !message.supportedProtocolVersions.includes("1")
          )
            throw new Error("invalid handshake");
          joinedId = message.senderId;
          sockets.set(message.senderId, socket);
          socket.send(
            cbor.encode({
              type: "peer",
              senderId: adapter.peerId,
              targetId: message.senderId,
              peerMetadata: adapter.peerMetadata,
              selectedProtocolVersion: "1",
            }),
          );
          adapter.emit("peer-candidate", {
            peerId: message.senderId,
            peerMetadata: message.peerMetadata,
          });
        } else {
          if (!joinedId || message.senderId !== joinedId || message.targetId !== adapter.peerId)
            throw new Error("invalid peer");
          adapter.emit("message", message);
        }
      } catch (error) {
        console.error("spike frame rejected", String(error));
        socket.close(1008, "Invalid sync frame");
      }
    });
    socket.addEventListener("close", () => {
      if (joinedId && sockets.get(joinedId) === socket) {
        sockets.delete(joinedId);
        adapter.emit("peer-disconnected", { peerId: joinedId });
      }
    });
  }
  return { adapter, accept };
}

/** Local-only feasibility host, deliberately separate from Yatma's UserSpace. */
export class AutomergeRoom extends DurableObject<Env> {
  private repo: Repo;
  private network = networkAdapter();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const storage = storageAdapter(ctx.storage);
    this.repo = new Repo({
      storage,
      network: [this.network.adapter],
      sharePolicy: async () => false,
    });
  }
  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      this.network.accept(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (new URL(request.url).pathname.startsWith("/flush/")) {
      await this.repo.flush();
      return Response.json({ persisted: true });
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.protocol !== "https:") return new Response("HTTPS required", { status: 400 });
    const match = /^\/(sync|flush)\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);
    if (url.searchParams.get("token") !== env.SPIKE_TOKEN)
      return new Response("Unauthorized", { status: 401 });
    return env.ROOMS.get(env.ROOMS.idFromName(match[2]!)).fetch(request);
  },
};
