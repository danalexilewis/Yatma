// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import * as OpenRouter from "./openrouter.ts";

describe("OpenRouter streaming", () => {
  it.effect("parses streamed text, tool-call deltas, and usage", () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const encoder = new TextEncoder();
      const lines = [
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"term\\"}"}}]}}],"usage":{"total_tokens":23}}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const line of lines) controller.enqueue(encoder.encode(line));
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    return Stream.runCollect(OpenRouter.streamChat({
      apiKey: Redacted.make("test-key"), model: "test-model",
    }, [{ role: "user", content: "hello" }], {
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: {} } }],
    })).pipe(
      Effect.tap((frames) => Effect.sync(() => {
        expect(requestBody?.stream).toBe(true);
        expect(frames.filter((frame) => frame.type === "text").map((frame) => frame.type === "text" ? frame.text : "").join("")).toBe("Hello world");
        const call = frames.find((frame) => frame.type === "tool_call");
        expect(call?.type === "tool_call" ? call.call.function.name : null).toBe("search");
        expect(call?.type === "tool_call" ? call.call.function.arguments : null).toBe('{"q":"term"}');
        expect(frames.find((frame) => frame.type === "usage")).toEqual({ type: "usage", tokens: 23 });
      })),
      Effect.ensuring(Effect.sync(() => { globalThis.fetch = originalFetch; })),
    );
  });
});
