// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/**
 * Placeholder LanguageModel-style stream for effect/ai wiring.
 * Replace with `@effect/ai` + OpenRouter once packages are available in catalog.
 */

export type ScriptedChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly name: string; readonly args: unknown }
  | { readonly type: "usage"; readonly tokens: number };

export type LanguageModel = {
  readonly complete: (prompt: string) => Stream.Stream<ScriptedChunk>;
};

/** Scripted model: emits fixed chunks regardless of prompt (test double). */
export function scriptedLanguageModel(chunks: readonly ScriptedChunk[]): LanguageModel {
  return {
    complete: (_prompt: string) => Stream.fromIterable(chunks),
  };
}

export function collectText(model: LanguageModel, prompt: string) {
  return model.complete(prompt).pipe(
    Stream.filter((c): c is Extract<ScriptedChunk, { type: "text" }> => c.type === "text"),
    Stream.map((c) => c.text),
    Stream.runFold(() => "", (acc, text) => acc + text),
  );
}

export function collectUsage(model: LanguageModel, prompt: string) {
  return model.complete(prompt).pipe(
    Stream.filter((c): c is Extract<ScriptedChunk, { type: "usage" }> => c.type === "usage"),
    Stream.map((c) => c.tokens),
    Stream.runFold(() => 0, (acc, n) => acc + n),
  );
}

/** Smoke that a scripted stream runs under Effect (no network). */
export const agentStreamProof = collectText(
  scriptedLanguageModel([
    { type: "text", text: "hello " },
    { type: "tool_call", name: "list_tasks", args: {} },
    { type: "text", text: "world" },
    { type: "usage", tokens: 12 },
  ]),
  "ping",
).pipe(Effect.map((text) => ({ text, ok: text === "hello world" })));
