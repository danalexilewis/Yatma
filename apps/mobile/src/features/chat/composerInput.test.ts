import { describe, expect, it } from "vite-plus/test";

import { parseComposerInput } from "./composerInput";

describe("conversation command boundaries", () => {
  it("recognizes only the complete list command with surrounding whitespace", () => {
    for (const value of ["/list", "/LIST", "  /list  ", "\n/list\n"]) {
      expect(parseComposerInput(value)).toEqual({ kind: "list" });
    }
  });

  it("keeps command-looking prose and former capture modes as ordinary LLM messages", () => {
    for (const text of [
      "/lists",
      "/list today",
      "Show /list here",
      "/list\nthen prioritize",
      "/message Hello",
      "/task Dentist",
      "/project Home",
      "/heading Work",
      "/list?",
      "https://example.test/list",
    ]) {
      expect(parseComposerInput(text)).toEqual({ kind: "message", text });
    }
    expect(parseComposerInput("  Plan my day  ")).toEqual({ kind: "message", text: "Plan my day" });
    expect(parseComposerInput("   ")).toEqual({ kind: "message", text: "" });
  });
});
