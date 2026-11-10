/**
 * Mobile UserSpace client — Effect RPC JSON over WebSocket (alchemy RpcDurableObject).
 *
 * Wire envelopes match effect/rpc RpcMessage + RpcSerialization.json:
 *   → { _tag:"Request", id, tag, payload, headers:[] }
 *   ← { _tag:"Chunk", requestId, values } | { _tag:"Exit", requestId, exit }
 * Stream RPCs also send { _tag:"Ack", requestId } after each Chunk.
 *
 * Remaining mismatches vs a full Effect RpcClient / core SpaceRpcGroup:
 * - No tracing headers / interruptors; Ack is best-effort for catch-up streams.
 * - Does not import alchemy/Cloudflare (RN-safe); hand-rolled socket framing only.
 * - Worker errors are SpaceError{code,message}; core exports tagged errors (ClockSkew, …).
 * - Worker chat.stop may include extra stopped/turnId fields beyond core `{ ok: true }`.
 */
import type {
  ChatSendInput,
  ChatStopInput,
  ChatStreamItem,
  ChatWrapUpInput,
  ChatWrapUpResult,
  DeviceId,
  Event,
  PingResult,
  SyncBatch,
  SyncPushResult,
  TurnFrame,
  TurnGetInput,
  TurnGetResult,
  TurnObserveInput,
  TurnReceipt,
  TurnStartInput,
  TurnStopInput,
  TurnStopResult,
  TranscribeInput,
  TranscribeResult,
  UsageGetResult,
} from "@yatma/core";
import { createClient } from "@eddy-works/never-rest/client";
import { syncContract } from "@yatma/contracts/sync";
import { turnContract } from "@yatma/contracts/turn";

export type SyncClientStatus = "idle" | "connecting" | "connected" | "error";

type SyncClientOptions = {
  readonly url: string;
  readonly getToken: () => Promise<string | null>;
  readonly onStatus: (status: SyncClientStatus) => void;
  /** Fired for each `sync.subscribe` stream batch. */
  readonly onSyncBatch?: (batch: SyncBatch) => void | Promise<void>;
};

type PendingUnary = {
  readonly kind: "unary";
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
};

type PendingStream = {
  readonly kind: "stream";
  readonly onChunk: (value: unknown) => void;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly markReady: () => void;
  readonly enqueue: (values: readonly unknown[]) => void;
};

type Pending = PendingUnary | PendingStream;

type ExitEncoded =
  | { readonly _tag: "Success"; readonly value: unknown }
  | {
      readonly _tag: "Failure";
      readonly cause: ReadonlyArray<{
        readonly _tag: string;
        readonly error?: unknown;
        readonly defect?: unknown;
      }>;
    };

/**
 * WebSocket RPC client for Worker UserSpace (Effect RpcMessage JSON).
 * Methods: ping, sync.push, sync.subscribe, account.delete, chat.send/stop/wrapUp, transcribe, usage.get.
 */
export function createSyncClient(options: SyncClientOptions) {
  const apiUrl = new URL(options.url);
  apiUrl.protocol = apiUrl.protocol === "wss:" ? "https:" : "http:";
  apiUrl.pathname = "/";
  apiUrl.search = "";
  apiUrl.hash = "";
  const api = createClient({ ...syncContract, ...turnContract }, {
    baseUrl: apiUrl.toString(),
    headers: async (): Promise<HeadersInit> => {
      const token = await options.getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  });

  async function unwrapApiResult<T>(result: { match: <U>(ok: (value: T) => U, error: (error: unknown) => U) => Promise<U> }): Promise<T> {
    return result.match(
      (value) => value,
      (error) => { throw error; },
    );
  }

  let socket: WebSocket | null = null;
  let requestId = 0;
  const pending = new Map<string | number, Pending>();
  let openPromise: Promise<void> | null = null;

  function nextId(): string {
    requestId += 1;
    return String(requestId);
  }

  function sendRaw(message: unknown): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("sync socket not connected");
    }
    socket.send(JSON.stringify(message));
  }

  function sendRequest(tag: string, payload: unknown): string {
    const id = nextId();
    sendRaw({
      _tag: "Request",
      id,
      tag,
      payload: payload ?? {},
      headers: [],
    });
    return id;
  }

  function sendAck(id: string | number): void {
    try {
      sendRaw({ _tag: "Ack", requestId: id });
    } catch {
      // Socket may already be closing after a one-shot stream.
    }
  }

  function callUnary(tag: string, payload: unknown): Promise<unknown> {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("sync socket not connected"));
    }
    const id = sendRequest(tag, payload);
    return new Promise((resolve, reject) => {
      pending.set(id, { kind: "unary", resolve, reject });
    });
  }

  function callStream(
    tag: string,
    payload: unknown,
    onChunk: (value: unknown) => void | Promise<void>,
  ): { readonly ready: Promise<void>; readonly completion: Promise<void> } {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const completion = Promise.reject<void>(new Error("sync socket not connected"));
      return { ready: completion, completion };
    }
    const id = sendRequest(tag, payload);
    const streamSocket = socket;
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    let isReady = false;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // Some consumers use only completion; keep early readiness failures handled.
    void ready.catch(() => {});
    void completion.catch(() => {});
    let chunkQueue = Promise.resolve();
    let failed = false;
    const stream: PendingStream = {
      kind: "stream",
      onChunk,
      resolve: () => {
        if (!isReady) rejectReady(new Error("stream completed before first chunk"));
        void chunkQueue.then(() => {
          if (failed) rejectCompletion(new Error("stream handler failed"));
          else resolveCompletion();
        });
      },
      reject: (error) => {
        failed = true;
        if (!isReady) rejectReady(error);
        rejectCompletion(error);
      },
      markReady: () => {
        if (isReady) return;
        isReady = true;
        resolveReady();
      },
      enqueue: (values) => {
        chunkQueue = chunkQueue
          .then(async () => {
            if (failed) return;
            for (const value of values) await onChunk(value);
            if (failed) return;
            sendAck(id);
          })
          .catch((error: unknown) => {
            failed = true;
            rejectCompletion(error);
            if (pending.get(id) === stream) pending.delete(id);
            if (socket === streamSocket) streamSocket?.close();
          });
      },
    };
    pending.set(id, stream);
    return { ready, completion };
  }

  function failExit(exit: ExitEncoded): Error {
    if (exit._tag === "Failure") {
      const fail = exit.cause.find((c) => c._tag === "Fail");
      if (fail?.error !== undefined) {
        return new Error(
          typeof fail.error === "object" &&
            fail.error !== null &&
            "message" in fail.error
            ? String((fail.error as { message: unknown }).message)
            : JSON.stringify(fail.error),
        );
      }
      return new Error("rpc failure");
    }
    return new Error("unexpected exit");
  }

  function handleServerMessage(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const record = data as Record<string, unknown>;
    const tag = record._tag;

    if (tag === "Chunk" && (typeof record.requestId === "string" || typeof record.requestId === "number")) {
      const entry = pending.get(record.requestId);
      if (!entry || entry.kind !== "stream") return;
      entry.markReady();
      const values = record.values;
      if (Array.isArray(values)) {
        entry.enqueue(values);
      } else {
        entry.enqueue([undefined]);
      }
      return;
    }

    if (tag === "Exit" && (typeof record.requestId === "string" || typeof record.requestId === "number")) {
      const entry = pending.get(record.requestId);
      if (!entry) return;
      pending.delete(record.requestId);
      const exit = record.exit as ExitEncoded | undefined;
      if (!exit) {
        entry.reject(new Error("missing exit"));
        return;
      }
      if (exit._tag === "Success") {
        if (entry.kind === "unary") entry.resolve(exit.value);
        else entry.resolve();
        return;
      }
      entry.reject(failExit(exit));
      return;
    }

    if (tag === "Defect") {
      options.onStatus("error");
    }
  }

  function connect(): Promise<void> {
    if (openPromise) return openPromise;
    options.onStatus("connecting");

    const attempt = (async () => {
      const token = await options.getToken();
      if (!token) {
        options.onStatus("idle");
        throw new Error("missing clerk token");
      }
      const url = new URL(options.url);
      url.searchParams.set("token", token);

      await new Promise<void>((resolve, reject) => {
        const connectedSocket = new WebSocket(url.toString());
        socket = connectedSocket;
        connectedSocket.onopen = () => {
          options.onStatus("connected");
          resolve();
        };
        connectedSocket.onerror = () => {
          options.onStatus("error");
          reject(new Error("sync socket error"));
        };
        connectedSocket.onclose = () => {
          if (socket !== connectedSocket) return;
          options.onStatus("idle");
          openPromise = null;
          for (const [, entry] of pending) {
            entry.reject(new Error("socket closed"));
          }
          pending.clear();
        };
        connectedSocket.onmessage = (message) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(message.data));
          } catch {
            return;
          }
          const frames = Array.isArray(parsed) ? parsed : [parsed];
          for (const frame of frames) handleServerMessage(frame);
        };
      });
    })();
    const guardedAttempt = attempt.catch((error: unknown) => {
      if (openPromise === guardedAttempt) openPromise = null;
      throw error;
    });
    openPromise = guardedAttempt;
    return guardedAttempt;
  }

  function disconnect(): void {
    openPromise = null;
    socket?.close();
    socket = null;
    for (const [, entry] of pending) {
      entry.reject(new Error("socket closed"));
    }
    pending.clear();
    options.onStatus("idle");
  }

  async function ping(): Promise<PingResult> {
    const result = await callUnary("ping", {});
    return result as PingResult;
  }

  async function push(input: {
    readonly events: readonly Event[];
    readonly deviceId: DeviceId | string;
  }): Promise<SyncPushResult> {
    return unwrapApiResult(api.pushEvents({ body: {
      events: input.events,
      deviceId: input.deviceId,
    } }));
  }

  function subscribe(after: number): { readonly ready: Promise<void>; readonly completion: Promise<void> } {
    return callStream("sync.subscribe", { after }, async (value) => {
      const batch = value as SyncBatch;
      if (batch && Array.isArray(batch.events)) {
        await options.onSyncBatch?.(batch);
      }
    });
  }

  async function deleteAccount(): Promise<{ readonly ok: true }> {
    const result = await callUnary("account.delete", {});
    return result as { readonly ok: true };
  }

  async function chatSend(
    input: ChatSendInput,
    onItem: (item: ChatStreamItem) => void,
  ): Promise<void> {
    const stream = callStream("chat.send", input, (value) => {
      onItem(value as ChatStreamItem);
    });
    await stream.completion;
  }

  async function chatStop(input: ChatStopInput): Promise<{ readonly ok: true }> {
    const result = await callUnary("chat.stop", input);
    return result as { readonly ok: true };
  }

  async function turnStart(input: TurnStartInput): Promise<TurnReceipt> {
    return unwrapApiResult(api.startTurn({ body: input }));
  }

  async function turnGet(input: TurnGetInput): Promise<TurnGetResult> {
    return unwrapApiResult(api.getTurn({ params: { turnId: input.turnId } }));
  }

  async function turnStop(input: TurnStopInput): Promise<TurnStopResult> {
    return unwrapApiResult(api.stopTurn({ params: { turnId: input.turnId }, body: input }));
  }

  function turnObserve(
    input: TurnObserveInput,
    onFrame: (frame: TurnFrame) => void,
  ): { readonly ready: Promise<void>; readonly completion: Promise<void> } {
    return callStream("turn.observe", input, (value) => {
      onFrame(value as TurnFrame);
    });
  }

  async function chatWrapUp(input: ChatWrapUpInput): Promise<ChatWrapUpResult> {
    const result = await callUnary("chat.wrapUp", input);
    return result as ChatWrapUpResult;
  }

  async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const result = await callUnary("transcribe", input);
    return result as TranscribeResult;
  }

  async function usageGet(): Promise<UsageGetResult> {
    const result = await callUnary("usage.get", {});
    return result as UsageGetResult;
  }

  /** Escape hatch for dictation / ad-hoc RPC. */
  async function callRpc(method: string, payload: unknown): Promise<unknown> {
    return callUnary(method, payload);
  }

  return {
    connect,
    disconnect,
    ping,
    push,
    subscribe,
    deleteAccount,
    chatSend,
    chatStop,
    turnStart,
    turnGet,
    turnStop,
    turnObserve,
    chatWrapUp,
    transcribe,
    usageGet,
    callRpc,
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;
