// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AgentToolkit } from "@yatma/core";
import * as Tool from "effect/ai/Tool";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as Response from "effect/ai/Response";
import * as Stream from "effect/Stream";
import * as AiError from "effect/ai/AiError";

/**
 * Minimal OpenRouter chat Completions client via fetch.
 * Prefer effect/ai when those packages land in the catalog.
 */

export class OpenRouterError extends Schema.TaggedError<OpenRouterError>()("OpenRouterError", {
  reason: Schema.String,
}) {}

export type OpenRouterConfig = {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model: string;
  readonly baseUrl?: string;
};

export type ChatMessage = {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
};

export type ToolDef = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
};

export type ToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type OpenRouterResult = {
  readonly text: string;
  readonly tokens: number;
  readonly toolCalls: readonly ToolCall[];
};

/** Build the Effect AI LanguageModel adapter while retaining OpenRouter's chat-completions API. */
export function makeOpenRouterLanguageModel(config: OpenRouterConfig) {
  const call = (options: LanguageModel.ProviderOptions) =>
    Effect.tryPromise({
      try: async () => {
        const messages = options.prompt.content.map((message) => {
          if (message.role === "assistant") {
            const content = message.content.map((part) =>
              part.type === "text" ? part.text : "",
            ).join("");
            const toolCalls = message.content.flatMap((part) =>
              part.type === "tool-call" ? [{
                id: part.id,
                type: "function" as const,
                function: { name: part.name, arguments: JSON.stringify(part.params) },
              }] : [],
            );
            return { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
          }
          if (message.role === "tool") {
            return { role: "tool", content: JSON.stringify(message.content), tool_call_id: "tool" };
          }
          return { role: message.role, content: message.content };
        });
        const defs = options.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: Tool.getDescription(tool) ?? "Yatma agent tool",
            parameters: Tool.getJsonSchema(tool),
          },
        }));
        const response = await fetch(`${config.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${Redacted.value(config.apiKey)}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            ...(defs.length ? { tools: defs, tool_choice: "auto" } : {}),
          }),
        });
        if (!response.ok) throw new Error(`http_${response.status}`);
        const data = await response.json() as {
          choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; tool_calls?: readonly ToolCall[] } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const choice = data.choices?.[0];
        const parts: Response.PartEncoded[] = [];
        if (choice?.message?.content) parts.push({ type: "text", text: choice.message.content });
        for (const call of choice?.message?.tool_calls ?? []) {
          let params: unknown = {};
          try { params = JSON.parse(call.function.arguments) as unknown; } catch { /* Toolkit validation returns declared tool failure. */ }
          parts.push({ type: "tool-call", id: call.id, name: call.function.name, params, providerExecuted: false });
        }
        parts.push({
          type: "finish",
          reason: choice?.finish_reason === "tool_calls" ? "tool-calls" : "stop",
          usage: {
            inputTokens: { total: data.usage?.prompt_tokens ?? 0 },
            outputTokens: { total: data.usage?.completion_tokens ?? 0 },
          },
        });
        return parts;
      },
      catch: (cause) => new AiError.AiError({
        module: "OpenRouter",
        method: "generateText",
        reason: new AiError.UnknownError({ description: String(cause) }),
      }),
    });

  return LanguageModel.make({
    generateText: call as never,
    streamText: ((options: LanguageModel.ProviderOptions) => Stream.fromEffect(call(options)).pipe(
      Stream.flatMap((parts) => Stream.fromIterable(parts)),
    )) as never,
  });
}

export function agentToolDefs(): readonly ToolDef[] {
  return Object.values(AgentToolkit.tools).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: Tool.getDescription(tool) ?? "Yatma agent tool",
      parameters: Tool.getJsonSchema(tool),
    },
  }));
}

export function completeChat(
  config: OpenRouterConfig,
  messages: readonly ChatMessage[],
  options?: {
    readonly tools?: readonly ToolDef[];
    readonly signal?: AbortSignal;
  },
) {
  return Effect.tryPromise({
    try: async () => {
      const base = config.baseUrl ?? "https://openrouter.ai/api/v1";
      const body: Record<string, unknown> = {
        model: config.model,
        messages: messages.map((message) => {
          const row: Record<string, unknown> = {
            role: message.role,
            content: message.content,
          };
          if (message.tool_call_id) row.tool_call_id = message.tool_call_id;
          if (message.tool_calls) row.tool_calls = message.tool_calls;
          return row;
        }),
      };
      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = "auto";
      }
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${Redacted.value(config.apiKey)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
      if (options?.signal) init.signal = options.signal;
      const response = await fetch(`${base}/chat/completions`, init);
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: ToolCall[];
          };
        }>;
        usage?: { total_tokens?: number };
      };
      const message = json.choices?.[0]?.message;
      const text = message?.content ?? "";
      const toolCalls = message?.tool_calls ?? [];
      const tokens = json.usage?.total_tokens ?? 0;
      return { text, tokens, toolCalls } satisfies OpenRouterResult;
    },
    catch: (cause) => new OpenRouterError({ reason: String(cause) }),
  });
}

/**
 * Stream OpenRouter Chat Completions as server-sent events. Text is yielded as
 * soon as each delta arrives; tool arguments are assembled by index and
 * emitted once complete so callers only dispatch valid calls.
 */
export function streamChat(
  config: OpenRouterConfig,
  messages: readonly ChatMessage[],
  options?: { readonly tools?: readonly ToolDef[]; readonly signal?: AbortSignal },
): Stream.Stream<{ readonly type: "text"; readonly text: string } | { readonly type: "tool_call"; readonly call: ToolCall } | { readonly type: "usage"; readonly tokens: number }, OpenRouterError> {
  const iterable = async function* () {
    const response = await fetch(`${config.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${Redacted.value(config.apiKey)}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        })),
        ...(options?.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new OpenRouterError({ reason: `http_${response.status}` });
    if (!response.body) throw new OpenRouterError({ reason: "missing_response_body" });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let buffer = "";
    let tokens = 0;
    let streamComplete = false;
    const handleData = (raw: string): Array<{ readonly type: "text"; readonly text: string }> => {
      if (raw === "[DONE]") return [];
      let data: {
        error?: { message?: string };
        choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{
          index: number; id?: string; function?: { name?: string; arguments?: string };
        }> } }>;
        usage?: { total_tokens?: number };
      };
      try { data = JSON.parse(raw) as typeof data; }
      catch { throw new OpenRouterError({ reason: "invalid_sse_json" }); }
      if (data.error) throw new OpenRouterError({ reason: data.error.message ?? "provider_error" });
      const delta = data.choices?.[0]?.delta;
      for (const part of delta?.tool_calls ?? []) {
        const current = toolCalls.get(part.index) ?? { id: "", name: "", arguments: "" };
        if (part.id) current.id = part.id;
        if (part.function?.name) current.name += part.function.name;
        if (part.function?.arguments) current.arguments += part.function.arguments;
        toolCalls.set(part.index, current);
      }
      if (data.usage?.total_tokens !== undefined) tokens = data.usage.total_tokens;
      return delta?.content ? [{ type: "text", text: delta.content }] : [];
    };

    const consumeLines = function* (text: string) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        yield* handleData(raw);
      }
    };

    try {
      while (true) {
        const part = await reader.read();
        if (part.done) {
          streamComplete = true;
          break;
        }
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const frame of consumeLines(lines.join("\n"))) yield frame;
      }
      buffer += decoder.decode();
      if (buffer.trim().startsWith("data:")) {
        for (const frame of consumeLines(buffer)) yield frame;
      }
      for (const [index, call] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
        yield {
          type: "tool_call" as const,
          call: {
            id: call.id || `call_${index}`,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments || "{}" },
          },
        };
      }
      yield { type: "usage" as const, tokens };
    } finally {
      if (!streamComplete) await reader.cancel(options?.signal?.reason).catch(() => undefined);
      reader.releaseLock();
    }
  };
  return Stream.fromAsyncIterable(iterable(), (cause) =>
    cause instanceof OpenRouterError ? cause : new OpenRouterError({ reason: String(cause) }),
  );
}

/** Cheap curator completion (no tools). */
export function completeCurator(
  config: OpenRouterConfig,
  messages: readonly ChatMessage[],
) {
  return completeChat(config, messages).pipe(
    Effect.map((result) => ({ text: result.text, tokens: result.tokens })),
  );
}
