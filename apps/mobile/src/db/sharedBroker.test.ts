import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

function broker() {
  const scope: { onconnect?: (event: unknown) => void } = {};
  const leases = new Map<string, () => void>();
  runInNewContext(readFileSync(new URL("../../public/sqlite-broker.js", import.meta.url), "utf8"), {
    self: scope,
    navigator: {
      locks: {
        request: (name: string, _options: unknown, callback?: () => void) => {
          if (callback) return Promise.resolve(callback());
          leases.set(name, _options as () => void);
          return new Promise(() => {});
        },
      },
    },
  });
  function connect(lease: string) {
    const port = {
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
      onmessage: null as null | ((event: unknown) => void),
    };
    scope.onconnect!({ ports: [port] });
    function send(data: unknown) {
      port.onmessage!({ data });
    }
    send({ type: "connect", lease });
    return { port, send };
  }
  return { connect, leases };
}

describe("shared SQLite broker", () => {
  it("isolates identical client handle and request IDs and routes results to their caller", async () => {
    const api = broker();
    const first = api.connect("first");
    const second = api.connect("second");
    await vi.waitFor(() =>
      expect(first.port.postMessage).toHaveBeenCalledWith({ type: "start-worker" }),
    );
    const sent: any[] = [];
    const worker = {
      start() {},
      close() {},
      onmessage: null as any,
      postMessage(message: any) {
        sent.push(message);
        queueMicrotask(() =>
          worker.onmessage({ data: { id: message.id, result: message.data.nativeDatabaseId } }),
        );
      },
    };
    first.send({ type: "worker-port", port: worker });
    first.send({ type: "open", id: 0, data: { nativeDatabaseId: 0 } });
    second.send({ type: "open", id: 0, data: { nativeDatabaseId: 0 } });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0].data.nativeDatabaseId).not.toBe(sent[1].data.nativeDatabaseId);
    expect(first.port.postMessage).toHaveBeenCalledWith({
      id: 0,
      result: sent[0].data.nativeDatabaseId,
    });
    expect(second.port.postMessage).toHaveBeenCalledWith({
      id: 0,
      result: sent[1].data.nativeDatabaseId,
    });
  });

  it("reconnects remaining clients if the worker host crashes and its lease ends", async () => {
    const api = broker();
    const first = api.connect("first");
    const second = api.connect("second");
    await vi.waitFor(() => expect(first.port.postMessage).toHaveBeenCalled());
    api.leases.get("first")!();
    expect(second.port.postMessage).toHaveBeenCalledWith({ type: "restart" });
  });
  it("rolls back a crashed secondary tab's transaction before serving another tab", async () => {
    const api = broker();
    const host = api.connect("host");
    const secondary = api.connect("secondary");
    await vi.waitFor(() => expect(host.port.postMessage).toHaveBeenCalled());
    const commands: any[] = [];
    const worker = {
      start() {},
      close() {},
      onmessage: null as any,
      postMessage(message: any) {
        commands.push(message);
        queueMicrotask(() => worker.onmessage({ data: { id: message.id, result: null } }));
      },
    };
    host.send({ type: "worker-port", port: worker });
    secondary.send({ type: "exec", id: 1, data: { nativeDatabaseId: 0, source: "BEGIN" } });
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    host.send({ type: "exec", id: 2, data: { nativeDatabaseId: 0, source: "SELECT 1" } });
    await Promise.resolve();
    expect(commands).toHaveLength(1);
    api.leases.get("secondary")!();
    await vi.waitFor(() =>
      expect(host.port.postMessage).toHaveBeenCalledWith({ id: 2, result: null }),
    );
    expect(commands.map((message) => message.data.source).filter(Boolean)).toEqual([
      "BEGIN",
      "ROLLBACK",
      "SELECT 1",
    ]);
  });
});
