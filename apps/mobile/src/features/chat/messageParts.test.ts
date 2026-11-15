import { formatRef, PERSONAL_THREAD_ID } from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { flattenThreadMessages, parseMessageParts } from "./messageParts";

const ref = "[Task](task:t_AAAAAAA1)";

describe("deterministic message parts", () => {
  it("keeps repeated occurrences, bullets, numbered prefixes and historical commentary", () => {
    const parts = parseMessageParts(
      `Start here\n- ${ref} — Original commentary\n2. ${ref}\n${ref}\nThe ${ref} stays inline.`,
    );
    expect(parts.map((part) => part.kind)).toEqual(["line", "task", "task", "task", "line"]);
    expect(parts[1]).toMatchObject({ prefix: "- ", commentary: "Original commentary" });
    expect(parts[2]).toMatchObject({ prefix: "2. " });
    expect(parts[4]).toMatchObject({
      kind: "line",
      parts: [
        { kind: "text", text: "The " },
        { kind: "ref", ref: { id: "t_AAAAAAA1" } },
        { kind: "text", text: " stays inline." },
      ],
    });
  });

  it("preserves invalid IDs and incomplete refs as plain text until they are complete", () => {
    expect(parseMessageParts("[Task](task:invented)")[0]).toMatchObject({
      kind: "line",
      parts: [{ kind: "text", text: "[Task](task:invented)" }],
    });
    expect(parseMessageParts("[Task](task:t_AAAAAAA1")[0]).toMatchObject({
      kind: "line",
      parts: [{ kind: "text", text: "[Task](task:t_AAAAAAA1" }],
    });
    expect(parseMessageParts(ref)[0]?.kind).toBe("task");
  });

  it("keeps escaped task titles usable in local receipts", () => {
    const text = formatRef("task", "t_AAAAAAA1", "Review [draft] \\ notes");
    expect(parseMessageParts(text)[0]).toMatchObject({
      kind: "task",
      label: "Review [draft] \\ notes",
    });
  });

  it("individually flattens 200 task occurrences using stable unambiguous keys", () => {
    const entry = {
      chatId: PERSONAL_THREAD_ID,
      message: {
        id: "reply",
        role: "assistant" as const,
        at: "2026-11-10T00:00:00Z",
        text: Array.from({ length: 200 }, () => ref).join("\n"),
      },
    };
    const rows = flattenThreadMessages([entry]);
    expect(rows).toHaveLength(201);
    expect(new Set(rows.map((row) => row.key)).size).toBe(201);
    expect(
      flattenThreadMessages([
        { ...entry, message: { ...entry.message, at: "2026-11-11T00:00:00Z" } },
      ]).map((row) => row.key),
    ).toEqual(rows.map((row) => row.key));
  });

  it("keeps project mentions as durable inline refs and rejects invalid project IDs", () => {
    const text = `Discuss ${formatRef("project", "p_AAAAAAA1", "Launch [phase]")} next.`;
    expect(parseMessageParts(text)[0]).toMatchObject({
      kind: "line",
      parts: [
        { kind: "text", text: "Discuss " },
        { kind: "ref", ref: { kind: "project", id: "p_AAAAAAA1", label: "Launch [phase]" } },
        { kind: "text", text: " next." },
      ],
    });
    expect(parseMessageParts("[Missing](project:invented)")[0]).toMatchObject({
      kind: "line",
      parts: [{ kind: "text", text: "[Missing](project:invented)" }],
    });
  });
});
