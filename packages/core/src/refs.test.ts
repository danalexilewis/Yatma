import { describe, expect, it } from "vite-plus/test";

import { classifyRefPlacement, extractRefs, parseRefHref } from "./refs.ts";

const taskId = "t_KG2CPWC0";
const pageId = "pg_A4T776XZ";
const chatId = "c_ZZTRJ9X9";
const taskIdB = "t_BCDEFGHJ";

describe("parseRefHref", () => {
  it("parses task, page, and chat refs", () => {
    expect(parseRefHref(`task:${taskId}`, "A")).toEqual({
      ok: true,
      ref: { kind: "task", id: taskId, label: "A" },
    });
    expect(parseRefHref(`page:${pageId}`).ok).toBe(true);
    expect(parseRefHref(`chat:${chatId}`).ok).toBe(true);
  });

  it("returns unknown_scheme for other hrefs", () => {
    expect(parseRefHref("https://example.com")).toEqual({
      ok: false,
      raw: "https://example.com",
      reason: "unknown_scheme",
    });
  });
});

describe("extractRefs", () => {
  it("finds markdown links with entity schemes", () => {
    const refs = extractRefs(`See [A](task:${taskId}) and [B](page:${pageId})`);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.kind).toBe("task");
    expect(refs[1]?.kind).toBe("page");
  });
});

describe("classifyRefPlacement", () => {
  it("classifies a lone ref line as a card", () => {
    expect(classifyRefPlacement(`[Task](task:${taskId})`, 0)).toBe("card");
  });

  it("classifies consecutive task lines as list items", () => {
    const text = `[A](task:${taskId})\n[B](task:${taskIdB})`;
    expect(classifyRefPlacement(text, 0)).toBe("list_item");
    expect(classifyRefPlacement(text, 1)).toBe("list_item");
  });
});
