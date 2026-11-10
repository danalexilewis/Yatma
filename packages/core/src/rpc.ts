// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { ChatId, DeviceId, EventId, ProjectId } from "./ids.ts";
import { Event } from "./events.ts";
import { Title } from "./schemas.ts";

export const Seq = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0));
export type Seq = typeof Seq.Type;

export class BudgetExceeded extends Schema.TaggedError<BudgetExceeded>()("BudgetExceeded", {
  used: Schema.Number,
  limit: Schema.Number,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

export class ClockSkew extends Schema.TaggedError<ClockSkew>()("ClockSkew", {
  at: Schema.String,
  now: Schema.String,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String,
}) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()("InternalError", {
  message: Schema.String,
}) {}

export const SpaceError = Schema.Union([
  BudgetExceeded,
  Unauthorized,
  ClockSkew,
  NotFound,
  InvalidRequest,
  InternalError,
]);
export type SpaceError = typeof SpaceError.Type;

export const SyncBatch = Schema.Struct({
  events: Schema.Array(Event),
  after: Seq,
});
export type SyncBatch = typeof SyncBatch.Type;

export const SyncPushInput = Schema.Struct({
  events: Schema.Array(Event),
  deviceId: DeviceId,
});
export type SyncPushInput = typeof SyncPushInput.Type;

export const SyncPushResult = Schema.Struct({
  accepted: Schema.Array(EventId),
  assigned: Schema.Array(
    Schema.Struct({
      id: EventId,
      seq: Seq,
    }),
  ),
});
export type SyncPushResult = typeof SyncPushResult.Type;

export const ChatSendInput = Schema.Struct({
  chatId: Schema.optional(ChatId),
  projectId: Schema.NullOr(ProjectId),
  text: Schema.String,
  /** Phone outbox events the agent must see before planning. */
  events: Schema.Array(Event),
});
export type ChatSendInput = typeof ChatSendInput.Type;

export const ChatStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("started"),
    chatId: ChatId,
    turnId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("text_delta"),
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool_started"),
    tool: Schema.String,
    toolCallId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("changes"),
    batchId: Schema.String,
    events: Schema.Array(Event),
    summary: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("done"),
    chatId: ChatId,
    turnId: Schema.String,
  }),
]);
export type ChatStreamItem = typeof ChatStreamItem.Type;

export const ChatStopInput = Schema.Struct({
  chatId: ChatId,
  turnId: Schema.optional(Schema.String),
});
export type ChatStopInput = typeof ChatStopInput.Type;

/** Durable turn lifecycle states exposed to clients after start or recovery. */
export const TurnStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "stopped",
  "failed",
  "interrupted",
]);
export type TurnStatus = typeof TurnStatus.Type;

export const TurnReceipt = Schema.Struct({
  turnId: Schema.String,
  chatId: ChatId,
  batchId: Schema.String,
  status: TurnStatus,
});
export type TurnReceipt = typeof TurnReceipt.Type;

/** Client identity makes retries safe without conflating repeated message text. */
export const TurnStartInput = Schema.Struct({
  requestId: Schema.String,
  messageId: Schema.String,
  chatId: Schema.optional(ChatId),
  projectId: Schema.NullOr(ProjectId),
  text: Schema.String,
  events: Schema.Array(Event),
});
export type TurnStartInput = typeof TurnStartInput.Type;

export const TurnGetInput = Schema.Struct({ turnId: Schema.String });
export type TurnGetInput = typeof TurnGetInput.Type;

export const TurnGetResult = Schema.Struct({
  receipt: TurnReceipt,
  resultText: Schema.NullOr(Schema.String),
  batches: Schema.Array(
    Schema.Struct({ batchId: Schema.String, events: Schema.Array(Event), summary: Schema.String }),
  ),
  error: Schema.NullOr(Schema.String),
});
export type TurnGetResult = typeof TurnGetResult.Type;

export const TurnStopInput = Schema.Struct({ turnId: Schema.String });
export type TurnStopInput = typeof TurnStopInput.Type;

export const TurnStopResult = Schema.Struct({ ok: Schema.Literal(true) });
export type TurnStopResult = typeof TurnStopResult.Type;

/** Sequenced frames belong to the host stream lifecycle, not the JSON contract. */
export const TurnFrame = Schema.Struct({ seq: Seq, item: ChatStreamItem });
export type TurnFrame = typeof TurnFrame.Type;

export const TurnObserveInput = Schema.Struct({ turnId: Schema.String, after: Seq });
export type TurnObserveInput = typeof TurnObserveInput.Type;

export const ChatWrapUpInput = Schema.Struct({
  chatId: ChatId,
});
export type ChatWrapUpInput = typeof ChatWrapUpInput.Type;

export const ChatWrapUpResult = Schema.Struct({
  batchId: Schema.String,
  events: Schema.Array(Event),
  title: Schema.NullOr(Title),
  summary: Schema.NullOr(Schema.String),
});
export type ChatWrapUpResult = typeof ChatWrapUpResult.Type;

export const TranscribeInput = Schema.Struct({
  /** Base64-encoded audio body. */
  audioBase64: Schema.String,
  mimeType: Schema.optional(Schema.String),
});
export type TranscribeInput = typeof TranscribeInput.Type;

export const TranscribeResult = Schema.Struct({
  text: Schema.String,
});
export type TranscribeResult = typeof TranscribeResult.Type;

export const UsageGetResult = Schema.Struct({
  used: Schema.Number,
  limit: Schema.Number,
  resetsAt: Schema.String,
});
export type UsageGetResult = typeof UsageGetResult.Type;

export const PingResult = Schema.Struct({
  ok: Schema.Literal(true),
  now: Schema.String,
});
export type PingResult = typeof PingResult.Type;

export const PingRpc = Rpc.make("ping", {
  success: PingResult,
  error: SpaceError,
});

export const SyncPushRpc = Rpc.make("sync.push", {
  payload: SyncPushInput,
  success: SyncPushResult,
  error: SpaceError,
});

export const SyncSubscribeRpc = Rpc.make("sync.subscribe", {
  payload: Schema.Struct({ after: Seq }),
  success: SyncBatch,
  error: SpaceError,
  stream: true,
});

export const ChatSendRpc = Rpc.make("chat.send", {
  payload: ChatSendInput,
  success: ChatStreamItem,
  error: SpaceError,
  stream: true,
});

export const ChatStopRpc = Rpc.make("chat.stop", {
  payload: ChatStopInput,
  success: Schema.Struct({ ok: Schema.Literal(true) }),
  error: SpaceError,
});

export const TurnStartRpc = Rpc.make("turn.start", {
  payload: TurnStartInput,
  success: TurnReceipt,
  error: SpaceError,
});

export const TurnGetRpc = Rpc.make("turn.get", {
  payload: TurnGetInput,
  success: TurnGetResult,
  error: SpaceError,
});

export const TurnStopRpc = Rpc.make("turn.stop", {
  payload: TurnStopInput,
  success: TurnStopResult,
  error: SpaceError,
});

export const TurnObserveRpc = Rpc.make("turn.observe", {
  payload: TurnObserveInput,
  success: TurnFrame,
  error: SpaceError,
  stream: true,
});

export const ChatWrapUpRpc = Rpc.make("chat.wrapUp", {
  payload: ChatWrapUpInput,
  success: ChatWrapUpResult,
  error: SpaceError,
});

export const TranscribeRpc = Rpc.make("transcribe", {
  payload: TranscribeInput,
  success: TranscribeResult,
  error: SpaceError,
});

export const UsageGetRpc = Rpc.make("usage.get", {
  success: UsageGetResult,
  error: SpaceError,
});

export const AccountDeleteRpc = Rpc.make("account.delete", {
  success: Schema.Struct({ ok: Schema.Literal(true) }),
  error: SpaceError,
});

/** All UserSpace RPCs shared by the phone and the Worker. */
export const SpaceRpcGroup = RpcGroup.make(
  PingRpc,
  SyncPushRpc,
  SyncSubscribeRpc,
  ChatSendRpc,
  ChatStopRpc,
  TurnStartRpc,
  TurnGetRpc,
  TurnStopRpc,
  TurnObserveRpc,
  ChatWrapUpRpc,
  TranscribeRpc,
  UsageGetRpc,
  AccountDeleteRpc,
);
