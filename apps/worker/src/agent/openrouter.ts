// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

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

const AGENT_TOOLS: readonly ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List open tasks in global priority order.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: ["string", "null"] },
          status: { type: "string", enum: ["todo", "in_progress", "done"] },
          quadrant: {
            type: ["string", "null"],
            enum: ["do", "schedule", "delegate", "eliminate", null],
          },
          includeRecentDone: { type: "boolean" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Full-text search over tasks, pages, and chats.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a task with history, a page, or a chat summary.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["task", "page", "chat"] },
          taskId: { type: "string" },
          pageId: { type: "string" },
          chatId: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_changes",
      description: "Apply one batch of project/task ops with a shared reason.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          ops: { type: "array", items: { type: "object" }, minItems: 1 },
        },
        required: ["reason", "ops"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_page",
      description: "Create or replace a page or brief.",
      parameters: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          projectId: { type: ["string", "null"] },
          kind: { type: "string", enum: ["brief", "page"] },
          title: { type: "string" },
          body: { type: "string" },
          pinned: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["projectId", "kind", "title", "body", "reason"],
      },
    },
  },
];

export function agentToolDefs(): readonly ToolDef[] {
  return AGENT_TOOLS;
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

/** Cheap curator completion (no tools). */
export function completeCurator(
  config: OpenRouterConfig,
  messages: readonly ChatMessage[],
) {
  return completeChat(config, messages).pipe(
    Effect.map((result) => ({ text: result.text, tokens: result.tokens })),
  );
}
