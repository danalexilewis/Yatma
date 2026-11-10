// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import * as OpenRouter from "./openrouter.ts";

export type GatewayFrame =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: OpenRouter.ToolCall }
  | { readonly type: "usage"; readonly tokens: number };

export interface ModelGateway {
  readonly stream: (
    messages: readonly OpenRouter.ChatMessage[],
    signal?: AbortSignal,
  ) => Stream.Stream<GatewayFrame, OpenRouter.OpenRouterError>;
}

/** OpenRouter gateway uses the core AgentToolkit-derived tool schemas. */
export function makeOpenRouterGateway(config: OpenRouter.OpenRouterConfig): ModelGateway {
  return {
    stream: (messages, signal) => OpenRouter.streamChat(config, messages, {
      tools: OpenRouter.agentToolDefs(),
      ...(signal ? { signal } : {}),
    }),
  };
}

/** Deterministic gateway for proofs and tests; each call consumes one scripted completion. */
export function makeScriptedGateway(responses: readonly OpenRouter.OpenRouterResult[]): ModelGateway & {
  readonly remaining: () => number;
} {
  const pending = [...responses];
  return {
    remaining: () => pending.length,
    stream: () => Stream.fromEffect(Effect.sync(() => pending.shift() ?? {
      text: "",
      tokens: 0,
      toolCalls: [],
    })).pipe(
      Stream.flatMap((result) => Stream.fromIterable([
        ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
        ...result.toolCalls.map((call) => ({ type: "tool_call" as const, call })),
        { type: "usage" as const, tokens: result.tokens },
      ])),
    ),
  };
}

/** Keep provider credentials redacted at the gateway boundary. */
export function openRouterConfig(input: { readonly key: string; readonly model: string }) {
  return { apiKey: Redacted.make(input.key), model: input.model } satisfies OpenRouter.OpenRouterConfig;
}
