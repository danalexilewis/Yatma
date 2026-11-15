import { describe, expect, it, vi } from "vite-plus/test";
import { ChatId } from "@yatma/core";

import { createSyncClient } from "./client";

class FakeWebSocket {
  static readonly OPEN = 1;
  static current: FakeWebSocket;
  static failNextHandshake = false;
  readonly failHandshake: boolean;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((message: { readonly data: string }) => void) | null = null;
  readonly sent: unknown[] = [];

  constructor() {
    this.failHandshake = FakeWebSocket.failNextHandshake;
    FakeWebSocket.failNextHandshake = false;
    FakeWebSocket.current = this;
    queueMicrotask(() => {
      if (this.failHandshake) this.onerror?.();
      else this.onopen?.();
    });
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message));
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function mockApiResponses(...values: readonly unknown[]) {
  const responses = [...values];
  const fetchMock = vi.fn(
    async (_request: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sync client stream lifecycle", () => {
  it("preserves HTTP upgrade advice and exposes the required-upgrade status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "upgrade_required",
              message: "Update Yatma to sync this workspace.",
              nextStep: "Install a current build. Your unsent changes remain on this device.",
            }),
            { status: 426, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const statuses: string[] = [];
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: (status) => {
        statuses.push(status);
      },
    });
    await expect(client.push({ events: [], deviceId: "device-1" })).rejects.toMatchObject({
      code: "upgrade_required",
      nextStep: "Install a current build. Your unsent changes remain on this device.",
    });
    expect(statuses).toEqual(["upgrade_required"]);
  });

  it("retains the RPC upgrade code with an actionable message and no acknowledgement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const statuses: string[] = [];
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: (status) => {
        statuses.push(status);
      },
    });
    await client.connect();
    const subscription = client.subscribe(7);
    const socket = FakeWebSocket.current;
    const request = socket.sent.find(
      (message) => (message as { tag?: string }).tag === "sync.subscribe",
    ) as { id: string };
    socket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: {
        _tag: "Failure",
        cause: [{ _tag: "Fail", error: { _tag: "InvalidRequest", message: "upgrade_required" } }],
      },
    });
    await expect(subscription.ready).rejects.toMatchObject({
      code: "upgrade_required",
      message: expect.stringContaining("Install a current build"),
    });
    await expect(subscription.completion).rejects.toMatchObject({ code: "upgrade_required" });
    expect(statuses.at(-1)).toBe("upgrade_required");
    expect(socket.sent.some((message) => (message as { _tag?: string })._tag === "Ack")).toBe(
      false,
    );
    client.disconnect();
  });

  it("exposes typed durable turn controls and observation frames", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const fetchMock = mockApiResponses(
      {
        turnId: "turn-1",
        chatId: "c_01234567",
        batchId: "batch-1",
        status: "running",
      },
      {
        receipt: {
          turnId: "turn-1",
          chatId: "c_01234567",
          batchId: "batch-1",
          status: "running",
        },
        resultText: "done",
        batches: [],
        error: null,
      },
      { ok: true },
    );
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
    });
    await client.connect();
    const activeSocket = FakeWebSocket.current;

    const receipt = {
      turnId: "turn-1",
      chatId: "c_01234567",
      batchId: "batch-1",
      status: "running",
    } as const;
    const startPromise = client.turnStart({
      requestId: "request-1",
      messageId: "message-1",
      projectId: null,
      text: "hello",
      events: [],
    });
    await expect(startPromise).resolves.toEqual(receipt);

    const result = {
      receipt,
      resultText: "done",
      batches: [],
      error: null,
    };
    const getPromise = client.turnGet({ turnId: receipt.turnId });
    await expect(getPromise).resolves.toEqual(result);

    const stopPromise = client.turnStop({ turnId: receipt.turnId });
    await expect(stopPromise).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requests = fetchMock.mock.calls.map(([request, init]) => ({
      url: String(request),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
    }));
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/api/turns"],
      ["GET", "/api/turns/turn-1"],
      ["POST", "/api/turns/turn-1/stop"],
    ]);
    expect(requests.every((request) => request.authorization === "Bearer token")).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).eventSchemaVersion).toBe(5);
    expect(new URL(requests[1]!.url).searchParams.get("eventSchemaVersion")).toBe("5");
    expect(
      activeSocket.sent.some((message) => (message as { tag?: string }).tag?.startsWith("turn.")),
    ).toBe(false);

    const observed: number[] = [];
    const observation = client.turnObserve({ turnId: receipt.turnId, after: 1 }, (frame) =>
      observed.push(frame.seq),
    );
    const observeRequest = activeSocket.sent.find(
      (message) => (message as { tag?: string }).tag === "turn.observe",
    ) as { id: string; payload: unknown };
    expect(observeRequest.payload).toEqual({
      turnId: receipt.turnId,
      after: 1,
      eventSchemaVersion: 5,
    });
    activeSocket.receive({
      _tag: "Chunk",
      requestId: observeRequest.id,
      values: [{ seq: 2, item: { kind: "text_delta", text: "done" } }],
    });
    await observation.ready;
    await vi.waitFor(() => expect(observed).toEqual([2]));
    activeSocket.receive({
      _tag: "Exit",
      requestId: observeRequest.id,
      exit: { _tag: "Success", value: undefined },
    });
    await observation.completion;
    client.disconnect();
  });

  it("pushes sync events through the authenticated unary HTTP contract", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const result = { accepted: [], assigned: [] };
    const fetchMock = mockApiResponses(result);
    const client = createSyncClient({
      url: "wss://worker.example.com/rpc",
      getToken: async () => "fresh-token",
      onStatus: () => {},
    });
    const pushed = await client.push({ events: [], deviceId: "device-1" });

    expect(pushed).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request, init] = fetchMock.mock.calls[0]!;
    expect(String(request)).toBe("https://worker.example.com/api/sync/events");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fresh-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      events: [],
      deviceId: "device-1",
      eventSchemaVersion: 5,
    });
  });

  it("allows another connection attempt after a handshake error", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.failNextHandshake = true;
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
    });

    await expect(client.connect()).rejects.toThrow("sync socket error");
    await expect(client.connect()).resolves.toBeUndefined();
    client.disconnect();
  });

  it("rejects readiness when the stream exits before its first Chunk", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
    });
    await client.connect();
    const activeSocket = FakeWebSocket.current;
    const subscription = client.subscribe(0);
    const request = activeSocket.sent.find(
      (message) => (message as { _tag?: string })._tag === "Request",
    ) as { id: string };

    activeSocket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: { _tag: "Failure", cause: [{ _tag: "Fail", error: { message: "subscribe failed" } }] },
    });

    await expect(subscription.ready).rejects.toThrow("subscribe failed");
    await expect(subscription.completion).rejects.toThrow("subscribe failed");
    client.disconnect();
  });

  it("waits for each chunk's durable handler before one chunk acknowledgement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
      onSyncBatch: async (batch) => {
        visited.push(batch.after);
        if (batch.after === 1) await firstHandler;
      },
    });
    await client.connect();
    const activeSocket = FakeWebSocket.current;

    const visited: number[] = [];
    let releaseFirst!: () => void;
    const firstHandler = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const subscription = client.subscribe(0);
    let readinessSettled = false;
    void subscription.ready.then(
      () => {
        readinessSettled = true;
      },
      () => {
        readinessSettled = true;
      },
    );
    await Promise.resolve();
    expect(readinessSettled).toBe(false);
    const request = activeSocket.sent.find(
      (message) => (message as { _tag?: string })._tag === "Request",
    ) as { id: string };

    activeSocket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [
        { events: [], after: 1 },
        { events: [], after: 2 },
      ],
    });
    await subscription.ready;
    expect(readinessSettled).toBe(true);
    await Promise.resolve();
    expect(visited).toEqual([1]);
    expect(
      activeSocket.sent.filter((message) => (message as { _tag?: string })._tag === "Ack"),
    ).toHaveLength(0);

    releaseFirst();
    await vi.waitFor(() => expect(visited).toEqual([1, 2]));
    await vi.waitFor(() =>
      expect(
        activeSocket.sent.filter((message) => (message as { _tag?: string })._tag === "Ack"),
      ).toHaveLength(1),
    );
    expect(visited).toEqual([1, 2]);
    expect(
      activeSocket.sent.filter((message) => (message as { _tag?: string })._tag === "Ack"),
    ).toHaveLength(1);

    activeSocket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: { _tag: "Success", value: undefined },
    });
    await subscription.completion;
    expect(
      activeSocket.sent.filter((message) => (message as { _tag?: string })._tag === "Ack"),
    ).toHaveLength(1);
    client.disconnect();
  });

  it("does not acknowledge a pending batch after its session disconnects", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    let startHandler!: () => void;
    let releaseHandler!: () => void;
    let finishHandler!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      startHandler = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handlerFinished = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
      onSyncBatch: async () => {
        startHandler();
        await handlerGate;
        finishHandler();
      },
    });
    await client.connect();
    const activeSocket = FakeWebSocket.current;
    const subscription = client.subscribe(0);
    const request = activeSocket.sent.find(
      (message) => (message as { _tag?: string })._tag === "Request",
    ) as { id: string };
    activeSocket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ events: [], after: 1 }],
    });

    await handlerStarted;
    client.disconnect();
    releaseHandler();
    await handlerFinished;
    await Promise.resolve();
    expect(
      activeSocket.sent.filter((message) => (message as { _tag?: string })._tag === "Ack"),
    ).toHaveLength(0);
    await expect(subscription.ready).resolves.toBeUndefined();
  });

  it("rejects an unsupported event before durable merge or cursor acknowledgement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onSyncBatch = vi.fn();
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
      onSyncBatch,
    });
    await client.connect();
    const activeSocket = FakeWebSocket.current;
    const subscription = client.subscribe(7);
    const request = activeSocket.sent.find(
      (message) => (message as { tag?: string }).tag === "sync.subscribe",
    ) as { id: string; payload: unknown };
    expect(request.payload).toEqual({ after: 7, eventSchemaVersion: 5 });
    activeSocket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ events: [{ type: "future.unsupported" }], after: 8 }],
    });

    await expect(subscription.completion).rejects.toThrow();
    expect(onSyncBatch).not.toHaveBeenCalled();
    expect(activeSocket.sent.some((message) => (message as { _tag?: string })._tag === "Ack")).toBe(
      false,
    );
    expect(activeSocket.readyState).toBe(3);
    client.disconnect();
  });

  it.each(["turn.observe", "chat.send"] as const)(
    "rejects unsupported events in %s before forwarding or acknowledging them",
    async (tag) => {
      vi.stubGlobal("WebSocket", FakeWebSocket);
      const client = createSyncClient({
        url: "ws://localhost",
        getToken: async () => "token",
        onStatus: () => {},
      });
      await client.connect();
      const handler = vi.fn();
      const completion =
        tag === "turn.observe"
          ? client.turnObserve({ turnId: "turn-1", after: 0 }, handler).completion
          : client.chatSend({ projectId: null, text: "hello", events: [] }, handler);
      const socket = FakeWebSocket.current;
      const request = socket.sent.find((message) => (message as { tag?: string }).tag === tag) as {
        id: string;
        payload: { eventSchemaVersion: number };
      };
      expect(request.payload.eventSchemaVersion).toBe(5);
      const item = {
        kind: "changes",
        batchId: "batch-1",
        summary: "Changed",
        events: [{ type: "future.created" }],
      };
      socket.receive({
        _tag: "Chunk",
        requestId: request.id,
        values: [tag === "turn.observe" ? { seq: 1, item } : item],
      });
      await expect(completion).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
      expect(socket.sent.some((message) => (message as { _tag?: string })._tag === "Ack")).toBe(
        false,
      );
      expect(socket.readyState).toBe(3);
      client.disconnect();
    },
  );

  it("rejects persisted turn results containing unsupported events", async () => {
    const fetchMock = mockApiResponses({
      receipt: { turnId: "turn-1", chatId: "c_01234567", batchId: "batch-1", status: "completed" },
      resultText: "Done",
      batches: [{ batchId: "batch-1", summary: "Changed", events: [{ type: "future.created" }] }],
      error: null,
    });
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
    });
    await expect(client.turnGet({ turnId: "turn-1" })).rejects.toBeDefined();
    expect(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("eventSchemaVersion"),
    ).toBe("5");
  });

  it("gates wrap-up requests and rejects unsupported events in its unary response", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createSyncClient({
      url: "ws://localhost",
      getToken: async () => "token",
      onStatus: () => {},
    });
    await client.connect();
    const completion = client.chatWrapUp({ chatId: ChatId.make("c_01234567") });
    const socket = FakeWebSocket.current;
    const request = socket.sent.find(
      (message) => (message as { tag?: string }).tag === "chat.wrapUp",
    ) as { id: string; payload: unknown };
    expect(request.payload).toEqual({ chatId: "c_01234567", eventSchemaVersion: 5 });
    socket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: {
        _tag: "Success",
        value: {
          batchId: "batch-1",
          events: [{ type: "future.created" }],
          title: null,
          summary: null,
        },
      },
    });
    await expect(completion).rejects.toThrow();
    client.disconnect();
  });
});
