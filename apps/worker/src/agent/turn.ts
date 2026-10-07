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

import * as EventStore from "../eventStore.ts";
import * as OpenRouter from "./openrouter.ts";
import * as Tools from "./tools.ts";
import * as Usage from "./usage.ts";

export type TurnInput = {
  readonly chatId: ChatId;
  readonly projectId: ProjectId | null;
  readonly text: string;
  readonly turnId: string;
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

function readUsageSnapshot() {
  return Effect.gen(function* () {
    const month = Usage.currentMonthKey();
    const storedMonth = yield* EventStore.getMeta("usage.month");
    if (storedMonth !== month) {
      yield* EventStore.setMeta("usage.month", month);
      yield* EventStore.setMeta("usage.tokens", "0");
    }
    const tokensRaw = yield* EventStore.getMeta("usage.tokens");
    return {
      used: Number(tokensRaw ?? "0") || 0,
      limit: Usage.getTokenCap(),
    };
  });
}

function recordTokens(tokens: number) {
  return Effect.gen(function* () {
    const snap = yield* readUsageSnapshot();
    const next = snap.used + Math.max(0, tokens);
    if (next > snap.limit) {
      return { ok: false as const, snapshot: snap };
    }
    yield* EventStore.setMeta("usage.tokens", String(next));
    return {
      ok: true as const,
      snapshot: { ...snap, used: next },
    };
  });
}

/**
 * Run one detached agent turn: context → OpenRouter (or stub) → tools → stream items.
 */
export function runAgentTurn(input: TurnInput) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const nowIso = new Date().toISOString();
      const actor = agentActor(input.chatId, input.model);
      const batchId = Tools.newBatchId();

      const snap = yield* readUsageSnapshot();
      if (snap.used >= snap.limit) {
        return yield* Effect.fail({
          _tag: "BudgetExceeded" as const,
          used: snap.used,
          limit: snap.limit,
        } satisfies TurnFail);
      }

      const folded = yield* EventStore.loadFolded;
      const bootstrap: Event[] = [];
      if (!folded.chats.has(input.chatId)) {
        bootstrap.push({
          v: 1,
          type: "chat.created",
          id: generateEventId(),
          at: nowIso,
          by: actor,
          chatId: input.chatId,
          projectId: input.projectId,
          title: null,
        });
      }

      // Persist the user turn if the phone outbox did not already include it.
      const alreadyHasUserText = [...(folded.chats.get(input.chatId)?.messages ?? [])].some(
        (message) => message.role === "user" && message.text === input.text,
      );
      if (!alreadyHasUserText) {
        bootstrap.push({
          v: 1,
          type: "chat.message",
          id: generateEventId(),
          at: nowIso,
          by: actor,
          chatId: input.chatId,
          messageId: `msg_${generateShortId("t_").slice(2)}`,
          role: "user",
          text: input.text,
        });
      }

      if (bootstrap.length > 0) {
        const pushed = yield* EventStore.pushEvents(bootstrap, nowIso);
        if (!pushed.ok) {
          return yield* Effect.fail({
            _tag: "Internal" as const,
            message: "persist_chat_bootstrap_failed",
          } satisfies TurnFail);
        }
      }

      const foldedAfter = yield* EventStore.loadFolded;
      const context = buildContext({
        today: todayIso(),
        projects: foldedAfter.projects,
        tasks: foldedAfter.tasks,
        pages: foldedAfter.pages,
        chats: foldedAfter.chats,
        projectId: input.projectId,
        chatId: input.chatId,
        tokenBudget: 6_000,
      });
      const contextBlock = contextText(context);

      const items: ChatStreamItem[] = [
        { kind: "started", chatId: input.chatId, turnId: input.turnId },
      ];

      let assistantText = "";
      let totalTokens = 0;

      if (!input.openRouterKey) {
        assistantText = `(stub) Heard: ${input.text.slice(0, 200)}\n\nContext tokens ≈ ${context.estimatedTokens}. Set OPENROUTER_API_KEY for live tools.`;
        items.push({ kind: "text_delta", text: assistantText });
      } else {
        const config: OpenRouter.OpenRouterConfig = {
          apiKey: Redacted.make(input.openRouterKey),
          model: input.model,
        };
        const messages: OpenRouter.ChatMessage[] = [
          {
            role: "system",
            content:
              "You are Yatma, a concise task assistant. Use tools to inspect and change tasks. Prefer apply_changes for mutations. Cite entities as markdown refs like [title](task:t_XXXXXXXX).",
          },
          {
            role: "system",
            content: `Workspace context:\n${contextBlock}`,
          },
          { role: "user", content: input.text },
        ];

        for (let round = 0; round < 4; round += 1) {
          if (input.signal.aborted) break;
          const completion = yield* OpenRouter.completeChat(config, messages, {
            tools: OpenRouter.agentToolDefs(),
            signal: input.signal,
          }).pipe(
            Effect.map(Option.some),
            Effect.catch(() => Effect.succeed(Option.none())),
          );
          if (Option.isNone(completion)) {
            assistantText =
              assistantText ||
              "I could not reach the model. Try again in a moment.";
            items.push({ kind: "text_delta", text: assistantText });
            break;
          }
          const result = completion.value;
          totalTokens += result.tokens;
          if (result.text) {
            assistantText += result.text;
            items.push({ kind: "text_delta", text: result.text });
          }
          if (result.toolCalls.length === 0) break;

          messages.push({
            role: "assistant",
            content: result.text || "",
            tool_calls: result.toolCalls,
          });

          for (const call of result.toolCalls) {
            if (input.signal.aborted) break;
            items.push({
              kind: "tool_started",
              tool: call.function.name,
              toolCallId: call.id,
            });
            const args = parseJsonObject(call.function.arguments) ?? {};
            const toolCtx: Tools.ToolActorContext = {
              actor,
              batchId,
              nowIso: new Date().toISOString(),
            };
            const toolResult = yield* dispatchTool(call.function.name, args, toolCtx);
            if (
              toolResult &&
              typeof toolResult === "object" &&
              "events" in toolResult &&
              Array.isArray((toolResult as { events: unknown }).events) &&
              (toolResult as { events: Event[] }).events.length > 0
            ) {
              const batch = toolResult as {
                batchId?: string;
                events: Event[];
                summary?: string;
              };
              items.push({
                kind: "changes",
                batchId: batch.batchId ?? batchId,
                events: batch.events,
                summary: batch.summary ?? "Changes applied",
              });
            }
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(toolResult),
            });
          }
        }
      }

      if (input.signal.aborted) {
        items.push({ kind: "done", chatId: input.chatId, turnId: input.turnId });
        return Stream.fromIterable(items);
      }

      if (assistantText.trim().length > 0) {
        yield* EventStore.pushEvents(
          [
            {
              v: 1,
              type: "chat.message",
              id: generateEventId(),
              at: new Date().toISOString(),
              by: actor,
              chatId: input.chatId,
              messageId: `msg_${generateShortId("t_").slice(2)}`,
              role: "assistant",
              text: assistantText,
            },
          ],
          new Date().toISOString(),
        );
      }

      if (totalTokens > 0) {
        const recorded = yield* recordTokens(totalTokens);
        if (!recorded.ok) {
          return yield* Effect.fail({
            _tag: "BudgetExceeded" as const,
            used: recorded.snapshot.used,
            limit: recorded.snapshot.limit,
          } satisfies TurnFail);
        }
      }

      items.push({ kind: "done", chatId: input.chatId, turnId: input.turnId });
      return Stream.fromIterable(items);
    }).pipe(
      Effect.mapError((err): TurnFail => {
        if (
          typeof err === "object" &&
          err !== null &&
          "_tag" in err &&
          ((err as TurnFail)._tag === "BudgetExceeded" ||
            (err as TurnFail)._tag === "Internal")
        ) {
          return err as TurnFail;
        }
        return { _tag: "Internal", message: String(err) };
      }),
    ),
  );
}

function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Tools.ToolActorContext,
) {
  return Effect.gen(function* () {
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
