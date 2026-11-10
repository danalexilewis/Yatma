// Copyright (c) T3 Tools / MIT — adapted for Yatma
import {
  type ChatId,
  type ChatStreamItem,
  type Event,
  type ProjectId,
  BatchId as BatchIdSchema,
  ChatId as ChatIdSchema,
  PageId as PageIdSchema,
  ProjectId as ProjectIdSchema,
  TaskId as TaskIdSchema,
  buildContext,
  contextText,
  generateEventId,
  generateShortId,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../eventStore.ts";
import * as OpenRouter from "./openrouter.ts";
import * as Tools from "./tools.ts";
import * as Usage from "./usage.ts";
import * as ModelGateway from "./modelGateway.ts";
import type { MutationService } from "../application/mutations.ts";

export type TurnInput = {
  readonly chatId: ChatId;
  readonly projectId: ProjectId | null;
  readonly text: string;
  readonly turnId: string;
  readonly requestId?: string;
  readonly messageId?: string;
  readonly batchId?: string;
  readonly mutations?: MutationService;
  readonly gateway?: ModelGateway.ModelGateway;
  readonly model: string;
  readonly openRouterKey: string | null;
  readonly signal: AbortSignal;
};

export type TurnFail =
  | { readonly _tag: "BudgetExceeded"; readonly used: number; readonly limit: number }
  | { readonly _tag: "Internal"; readonly message: string };

function agentActor(chatId: ChatId, model: string) {
  return { kind: "agent" as const, chatId, model };
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function toTurnFail(error: unknown): TurnFail {
  if (typeof error === "object" && error !== null && "_tag" in error &&
      ((error as TurnFail)._tag === "BudgetExceeded" || (error as TurnFail)._tag === "Internal")) {
    return error as TurnFail;
  }
  return { _tag: "Internal", message: String(error) };
}

/**
 * Run one detached agent turn: context → OpenRouter (or stub) → tools → stream items.
 */
export function runAgentTurn(input: TurnInput) {
  let reservationId: string | null = null;
  let actualTokens = 0;
  return Stream.unwrap(Effect.gen(function* () {
    const nowIso = new Date().toISOString();
    const actor = agentActor(input.chatId, input.model);
    const batchId = input.batchId ? BatchIdSchema.make(input.batchId) : Tools.newBatchId();
    const messageId = input.messageId ?? `msg_${input.turnId}`;

    if (input.openRouterKey) {
      const reserved = yield* Usage.reserve(input.requestId ?? input.turnId, 30_000);
      if (!reserved.ok) {
        return yield* Effect.fail({
          _tag: "BudgetExceeded" as const,
          used: reserved.snapshot.used + reserved.snapshot.reserved,
          limit: reserved.snapshot.limit,
        } satisfies TurnFail);
      }
      reservationId = reserved.reservation.reservationId;
    }

    const folded = yield* EventStore.loadFolded;
    const bootstrap: Event[] = [];
    if (!folded.chats.has(input.chatId)) {
      bootstrap.push({
        v: 1, type: "chat.created", id: generateEventId(), at: nowIso, by: actor,
        chatId: input.chatId, projectId: input.projectId, title: null,
      });
    }
    const alreadyHasUserText = [...(folded.chats.get(input.chatId)?.messages ?? [])].some(
      (message) => message.role === "user" && message.id === messageId,
    );
    if (!alreadyHasUserText) {
      bootstrap.push({
        v: 1, type: "chat.message", id: generateEventId(), at: nowIso, by: actor,
        chatId: input.chatId, messageId, role: "user", text: input.text,
      });
    }
    if (bootstrap.length > 0) {
      if (input.mutations) {
        const commands = [];
        if (!folded.chats.has(input.chatId)) {
          commands.push({ type: "chat.create" as const, chatId: input.chatId, input: { projectId: input.projectId, title: null } });
        }
        if (!alreadyHasUserText) {
          commands.push({ type: "chat.message" as const, chatId: input.chatId, messageId, role: "user" as const, text: input.text });
        }
        yield* input.mutations.executeBatch({ commands, actor, batchId, now: nowIso });
      } else {
        const pushed = yield* EventStore.pushEvents(bootstrap, nowIso);
        if (!pushed.ok) {
          return yield* Effect.fail({ _tag: "Internal" as const, message: "persist_chat_bootstrap_failed" } satisfies TurnFail);
        }
      }
    }

    const foldedAfter = yield* EventStore.loadFolded;
    const context = buildContext({
      today: todayIso(), projects: foldedAfter.projects, tasks: foldedAfter.tasks,
      pages: foldedAfter.pages, chats: foldedAfter.chats, projectId: input.projectId,
      chatId: input.chatId, tokenBudget: 6_000,
    });
    const contextBlock = contextText(context);
    let assistantText = "";

    const complete = (): Stream.Stream<ChatStreamItem, TurnFail, SqlClient.SqlClient> => Stream.unwrap(Effect.gen(function* () {
      if (!input.signal.aborted && assistantText.trim().length > 0) {
        if (input.mutations) {
          yield* input.mutations.executeBatch({
            commands: [{ type: "chat.message", chatId: input.chatId, messageId: `msg_${input.turnId}_assistant`, role: "assistant", text: assistantText }],
            actor, batchId, now: new Date().toISOString(),
          });
        } else {
          const pushed = yield* EventStore.pushEvents([{
            v: 1, type: "chat.message", id: generateEventId(), at: new Date().toISOString(), by: actor,
            chatId: input.chatId, messageId: `msg_${input.turnId}_assistant`, role: "assistant", text: assistantText,
          }], new Date().toISOString());
          if (!pushed.ok) return yield* Effect.fail({ _tag: "Internal" as const, message: "persist_assistant_message_failed" } satisfies TurnFail);
        }
      }
      return Stream.make({ kind: "done", chatId: input.chatId, turnId: input.turnId });
    }).pipe(Effect.mapError(toTurnFail)));

    const runToolCalls = (
      calls: readonly OpenRouter.ToolCall[],
      messages: OpenRouter.ChatMessage[],
      nextRoundIndex: number,
      index = 0,
    ): Stream.Stream<ChatStreamItem, TurnFail, SqlClient.SqlClient> => Stream.suspend(() => {
      const call = calls[index];
      if (!call || input.signal.aborted) return round(nextRoundIndex);
      const started: ChatStreamItem = { kind: "tool_started", tool: call.function.name, toolCallId: call.id };
      const execute = Stream.unwrap(Effect.gen(function* () {
        const args = parseJsonObject(call.function.arguments) ?? {};
        const toolCtx: Tools.ToolActorContext = {
          actor, batchId, nowIso: new Date().toISOString(),
          ...(input.mutations ? { mutations: input.mutations } : {}),
        };
        const toolResult = yield* dispatchTool(call.function.name, args, toolCtx).pipe(Effect.mapError(toTurnFail));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
        let changeItem: ChatStreamItem | null = null;
        if (toolResult && typeof toolResult === "object" && "events" in toolResult &&
            Array.isArray((toolResult as { events: unknown }).events) && (toolResult as { events: Event[] }).events.length > 0) {
          const batch = toolResult as { batchId?: string; events: Event[]; summary?: string };
          changeItem = {
            kind: "changes", batchId: batch.batchId ?? batchId, events: batch.events,
            summary: batch.summary ?? "Changes applied",
          };
        }
        return changeItem;
      }).pipe(
        Effect.mapError(toTurnFail),
        Effect.map((changeItem) => Stream.concat(
          changeItem ? Stream.make(changeItem) : Stream.empty,
          runToolCalls(calls, messages, nextRoundIndex, index + 1),
        )),
      ));
      return Stream.concat(Stream.make(started), execute);
    });

    const round = (roundIndex: number): Stream.Stream<ChatStreamItem, TurnFail, SqlClient.SqlClient> => Stream.suspend(() => {
      if (input.signal.aborted || roundIndex >= 4) return complete();
      const config: OpenRouter.OpenRouterConfig = {
        apiKey: Redacted.make(input.openRouterKey ?? ""), model: input.model,
      };
      const messages: OpenRouter.ChatMessage[] = roundIndex === 0 ? [
        {
          role: "system",
          content: "You are Yatma, a concise task assistant. Use tools to inspect and change tasks. Prefer apply_changes for mutations. Cite entities as markdown refs like [title](task:t_XXXXXXXX).",
        },
        { role: "system", content: `Workspace context:\n${contextBlock}` },
        { role: "user", content: input.text },
      ] : roundMessages;
      // The shared message history is retained between tool rounds.
      if (roundIndex === 0) roundMessages = messages;
      let roundText = "";
      let tokens = 0;
      let calls: OpenRouter.ToolCall[] = [];
      let providerFailed = false;
      const gateway = input.gateway ?? ModelGateway.makeOpenRouterGateway(config);
      const frames = gateway.stream(messages, input.signal).pipe(
        Stream.tap((frame) => Effect.sync(() => {
          if (frame.type === "text") {
            roundText += frame.text;
            assistantText += frame.text;
          }
          else if (frame.type === "tool_call") calls.push(frame.call);
          else tokens += frame.tokens;
        })),
        Stream.filter((frame): frame is Extract<ModelGateway.GatewayFrame, { readonly type: "text" }> => frame.type === "text" && frame.text.length > 0),
        Stream.map((frame) => ({ kind: "text_delta", text: frame.text } satisfies ChatStreamItem)),
        Stream.catch(() => {
          providerFailed = true;
          if (input.signal.aborted) return Stream.empty;
          if (roundText.length === 0) {
            const fallback = "I could not reach the model. Try again in a moment.";
            roundText = fallback;
            assistantText += fallback;
            return Stream.make({ kind: "text_delta", text: fallback });
          }
          return Stream.empty;
        }),
      );
      const afterFrames = Stream.unwrap(Effect.sync(() => {
        actualTokens += tokens;
        if (providerFailed || calls.length === 0) return complete();
        messages.push({ role: "assistant", content: roundText, tool_calls: calls });
        return runToolCalls(calls, messages, roundIndex + 1);
      }));
      return Stream.concat(frames, afterFrames);
    });

    let roundMessages: OpenRouter.ChatMessage[] = [];
    const progress = input.openRouterKey
      ? round(0)
      : Stream.concat(
        Stream.make({ kind: "text_delta", text: `(stub) Heard: ${input.text.slice(0, 200)}\n\nContext tokens ≈ ${context.estimatedTokens}. Set OPENROUTER_API_KEY for live tools.` }),
        complete(),
      );
    const output = Stream.concat(Stream.make({ kind: "started", chatId: input.chatId, turnId: input.turnId }), progress);
    return Stream.ensuring(output, Effect.suspend(() =>
      reservationId ? Usage.settle(reservationId, actualTokens).pipe(Effect.asVoid, Effect.ignore) : Effect.void,
    ));
  }).pipe(
    Effect.catchCause((cause) => Effect.gen(function* () {
      if (reservationId) yield* Usage.settle(reservationId, actualTokens).pipe(Effect.asVoid, Effect.ignore);
      return yield* Effect.failCause(cause);
    })),
    Effect.mapError((err): TurnFail => {
      if (typeof err === "object" && err !== null && "_tag" in err &&
          ((err as TurnFail)._tag === "BudgetExceeded" || (err as TurnFail)._tag === "Internal")) return err as TurnFail;
      return { _tag: "Internal", message: String(err) };
    }),
  ));
}

function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Tools.ToolActorContext,
) {
  return Effect.gen(function* () {
    const schemaTool = Tools.getToolkitTool(name);
    if (!schemaTool || Option.isNone(Schema.decodeUnknownOption(schemaTool.parametersSchema as never)(args))) {
      return { error: `invalid arguments for ${name}` };
    }
    switch (name) {
      case "list_tasks": {
        const projectIdRaw = asNullableString(args.projectId);
        const listInput: Tools.ListTasksInput = {
          includeRecentDone: Boolean(args.includeRecentDone),
        };
        if (projectIdRaw !== undefined) {
          listInput.projectId =
            projectIdRaw === null ? null : ProjectIdSchema.make(projectIdRaw);
        }
        if (args.status === "todo" || args.status === "in_progress" || args.status === "done") {
          listInput.status = args.status;
        }
        if (args.quadrant === null || typeof args.quadrant === "string") {
          listInput.quadrant = (args.quadrant === null ? null : args.quadrant) as never;
        }
        if (typeof args.limit === "number") listInput.limit = args.limit;
        return yield* Tools.listTasks(listInput);
      }
      case "search": {
        const query = asString(args.query);
        if (!query) return { error: "query required" };
        return yield* Tools.search(
          typeof args.limit === "number" ? { query, limit: args.limit } : { query },
        );
      }
      case "read": {
        const kind = asString(args.kind);
        if (kind === "task" && asString(args.taskId)) {
          return yield* Tools.read({
            kind: "task",
            taskId: TaskIdSchema.make(asString(args.taskId)!),
          });
        }
        if (kind === "page" && asString(args.pageId)) {
          return yield* Tools.read({
            kind: "page",
            pageId: PageIdSchema.make(asString(args.pageId)!),
          });
        }
        if (kind === "chat" && asString(args.chatId)) {
          return yield* Tools.read({
            kind: "chat",
            chatId: ChatIdSchema.make(asString(args.chatId)!),
          });
        }
        return { error: "invalid read args" };
      }
      case "apply_changes": {
        const reason = asString(args.reason);
        const ops = Array.isArray(args.ops) ? args.ops : null;
        if (!reason || !ops) return { error: "reason and ops required" };
        return yield* Tools.applyChanges(
          { reason, ops: ops as never },
          { ...ctx, batchId: BatchIdSchema.make(String(ctx.batchId)) },
        );
      }
      case "write_page": {
        const reason = asString(args.reason);
        const title = asString(args.title);
        const body = asString(args.body);
        const kind = asString(args.kind);
        const projectIdRaw = asNullableString(args.projectId);
        if (!reason || !title || body === undefined || !kind || projectIdRaw === undefined) {
          return { error: "write_page missing fields" };
        }
        const writeInput: {
          pageId?: ReturnType<typeof PageIdSchema.make>;
          projectId: ReturnType<typeof ProjectIdSchema.make> | null;
          kind: "brief" | "page";
          title: string;
          body: string;
          pinned?: boolean;
          reason: string;
        } = {
          projectId: projectIdRaw === null ? null : ProjectIdSchema.make(projectIdRaw),
          kind: kind as "brief" | "page",
          title,
          body,
          reason,
        };
        if (asString(args.pageId)) writeInput.pageId = PageIdSchema.make(asString(args.pageId)!);
        if (typeof args.pinned === "boolean") writeInput.pinned = args.pinned;
        return yield* Tools.writePage(writeInput, ctx);
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  });
}

export function newChatId(): ChatId {
  return ChatIdSchema.make(generateShortId("c_"));
}
