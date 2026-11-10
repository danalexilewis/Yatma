import { describe, expect, it, vi } from "vite-plus/test";
import { PERSONAL_THREAD_ID } from "@yatma/core";

const mocks = vi.hoisted(() => ({
  loadOutboxEvents: vi.fn(),
  getSyncMeta: vi.fn(),
  setSyncMeta: vi.fn(),
  getSyncEngine: vi.fn(),
  syncMeta: new Map<string, string>(),
}));

vi.mock("../db/database", () => ({
  getSyncMeta: mocks.getSyncMeta,
  loadOutboxEvents: mocks.loadOutboxEvents,
  setSyncMeta: mocks.setSyncMeta,
}));
vi.mock("./engine", () => ({ getSyncEngine: mocks.getSyncEngine }));

import {
  findActiveChatTurn,
  getChatTurn,
  observeChatTurn,
  resumeChatTurn,
  sendChatTurn,
} from "./chatClient";

mocks.getSyncMeta.mockImplementation(async (key: string) => mocks.syncMeta.get(key) ?? null);
mocks.setSyncMeta.mockImplementation(async (key: string, value: string) => {
  mocks.syncMeta.set(key, value);
});

function resetMeta(): void {
  mocks.syncMeta.clear();
}

describe("chat turn client", () => {
  it("starts with fresh identities and emits the stable receipt before observing", async () => {
    resetMeta();
    mocks.loadOutboxEvents.mockResolvedValue([]);
    const receipt = {
      turnId: "turn-1",
      chatId: "chat-1",
      batchId: "batch-1",
      status: "running",
    };
    let releaseObservation!: () => void;
    const completion = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    const client = {
      turnStart: vi.fn().mockResolvedValue(receipt),
      turnObserve: vi.fn().mockReturnValue({ ready: Promise.resolve(), completion }),
      turnGet: vi.fn().mockResolvedValue({
        receipt: { ...receipt, status: "completed" },
        resultText: null,
        batches: [],
        error: null,
      }),
    };
    mocks.getSyncEngine.mockReturnValue({ client });

    const items: unknown[] = [];
    const first = sendChatTurn({
      projectId: null,
      text: "repeat text",
      handlers: { onItem: (item) => items.push(item) },
    });
    await vi.waitFor(() => expect(client.turnObserve).toHaveBeenCalledTimes(1));
    expect(items).toEqual([{ kind: "started", chatId: "chat-1", turnId: "turn-1" }]);
    const firstInput = client.turnStart.mock.calls[0]?.[0];
    expect(firstInput?.requestId).toBeTruthy();
    expect(firstInput?.messageId).toBeTruthy();
    expect(firstInput?.chatId).toBe(PERSONAL_THREAD_ID);
    releaseObservation();
    await expect(first).resolves.toEqual(receipt);
    await expect(findActiveChatTurn(receipt.chatId)).resolves.toBeNull();

    client.turnObserve.mockReturnValue({ ready: Promise.resolve(), completion: Promise.resolve() });
    await sendChatTurn({
      projectId: null,
      text: "repeat text",
      handlers: { onItem: () => {} },
    });
    const secondInput = client.turnStart.mock.calls[1]?.[0];
    expect(secondInput?.requestId).not.toBe(firstInput?.requestId);
    expect(secondInput?.messageId).not.toBe(firstInput?.messageId);
    expect(secondInput?.chatId).toBe(PERSONAL_THREAD_ID);
  });

  it("keeps the receipt usable for reattachment when observation fails", async () => {
    resetMeta();
    mocks.loadOutboxEvents.mockResolvedValue([]);
    const receipt = {
      turnId: "turn-recoverable",
      chatId: "chat-1",
      batchId: "batch-1",
      status: "running",
    };
    const client = {
      turnStart: vi.fn().mockResolvedValue(receipt),
      turnObserve: vi.fn().mockReturnValue({
        ready: Promise.resolve(),
        completion: Promise.reject(new Error("socket closed")),
      }),
      turnGet: vi.fn().mockResolvedValue({ receipt, resultText: "recovered", batches: [], error: null }),
    };
    mocks.getSyncEngine.mockReturnValue({ client });
    const items: unknown[] = [];
    const onError = vi.fn();

    await expect(sendChatTurn({
      projectId: null,
      text: "hello",
      handlers: { onItem: (item) => items.push(item), onError },
    })).rejects.toThrow("socket closed");
    expect(items).toEqual([{ kind: "started", chatId: "chat-1", turnId: receipt.turnId }]);
    expect(onError).toHaveBeenCalled();
    await expect(findActiveChatTurn(receipt.chatId)).resolves.toBe(receipt.turnId);
    await expect(getChatTurn(receipt.turnId)).resolves.toMatchObject({ resultText: "recovered" });

    const observer = observeChatTurn({
      turnId: receipt.turnId,
      after: 7,
      handlers: { onItem: () => {} },
    });
    expect(client.turnObserve).toHaveBeenLastCalledWith(
      { turnId: receipt.turnId, after: 7 },
      expect.any(Function),
    );
    await expect(observer.ready).resolves.toBeUndefined();
  });

  it("replays terminal turn text and batches, then clears the stored turn ID", async () => {
    resetMeta();
    mocks.syncMeta.set("chat.activeTurn:chat-1", "turn-complete");
    const receipt = {
      turnId: "turn-complete",
      chatId: "chat-1",
      batchId: "batch-1",
      status: "completed",
    };
    const events = [{ id: "event-1" }];
    const client = {
      turnGet: vi.fn().mockResolvedValue({
        receipt,
        resultText: "finished",
        batches: [{ batchId: "batch-1", events, summary: "Created a task" }],
        error: null,
      }),
      turnObserve: vi.fn(),
    };
    mocks.getSyncEngine.mockReturnValue({ client });
    const items: unknown[] = [];

    await expect(resumeChatTurn({
      chatId: receipt.chatId,
      handlers: { onItem: (item) => items.push(item) },
    })).resolves.toMatchObject({ receipt });

    expect(items).toEqual([
      { kind: "started", chatId: receipt.chatId, turnId: receipt.turnId },
      { kind: "text_delta", text: "finished" },
      { kind: "changes", batchId: "batch-1", events, summary: "Created a task" },
      { kind: "done", chatId: receipt.chatId, turnId: receipt.turnId },
    ]);
    expect(client.turnObserve).not.toHaveBeenCalled();
    await expect(findActiveChatTurn(receipt.chatId)).resolves.toBeNull();
  });

  it("resumes a running turn from seq 1 and retains its ID if observation drops", async () => {
    resetMeta();
    mocks.syncMeta.set("chat.activeTurn:chat-1", "turn-running");
    const receipt = {
      turnId: "turn-running",
      chatId: "chat-1",
      batchId: "batch-1",
      status: "running",
    };
    const client = {
      turnGet: vi.fn().mockResolvedValue({ receipt, resultText: null, batches: [], error: null }),
      turnObserve: vi.fn().mockReturnValue({
        ready: Promise.resolve(),
        completion: Promise.reject(new Error("socket closed")),
      }),
    };
    mocks.getSyncEngine.mockReturnValue({ client });

    await expect(resumeChatTurn({
      chatId: receipt.chatId,
      handlers: { onItem: () => {} },
    })).rejects.toThrow("socket closed");
    expect(client.turnObserve).toHaveBeenCalledWith(
      { turnId: receipt.turnId, after: 1 },
      expect.any(Function),
    );
    await expect(findActiveChatTurn(receipt.chatId)).resolves.toBe(receipt.turnId);
  });
});
