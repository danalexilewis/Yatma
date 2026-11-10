import { describe, expect, it } from "vite-plus/test";

import { parseComposerInput } from "./composerInput";

describe("thread composer commands", () => {
  it("selects task/project capture from a message and leaves an empty command unsent", () => {
    expect(parseComposerInput("/task Book the dentist", "message")).toEqual({
      mode: "task",
      text: "Book the dentist",
      command: true,
    });
    expect(parseComposerInput("/heading Home", "message")).toEqual({
      mode: "project",
      text: "Home",
      command: true,
    });
    expect(parseComposerInput("/project Home", "message")).toEqual({
      mode: "project",
      text: "Home",
      command: true,
    });
    expect(parseComposerInput("/task", "message")).toEqual({
      mode: "task",
      text: "",
      command: true,
    });
  });

  it("keeps ordinary slash text and respects dropdown selection", () => {
    expect(parseComposerInput("Review /tasks endpoint", "task")).toEqual({
      mode: "task",
      text: "Review /tasks endpoint",
      command: false,
    });
    expect(parseComposerInput("/tasks", "message")).toEqual({
      mode: "message",
      text: "/tasks",
      command: false,
    });
    expect(parseComposerInput("/message Hello", "task").mode).toBe("message");
  });
});
