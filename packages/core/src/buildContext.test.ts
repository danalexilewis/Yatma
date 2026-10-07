// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import { buildContext } from "./buildContext.ts";
import { ChatId, DeviceId, PageId, ProjectId, TaskId } from "./ids.ts";
import type { Chat, Page, Project, Task } from "./schemas.ts";

const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };
const projectId = ProjectId.make("p_AAAAAAA1");

function makeTask(id: string, title: string, position: string, overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.make(id),
    projectId,
    title,
    notes: "",
    dueDate: null,
    status: "todo",
    quadrant: null,
    position,
    createdAt: "2026-10-06T00:00:00.000Z",
    createdBy: user,
    updatedAt: "2026-10-06T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    lastReason: null,
    ...overrides,
  };
}

function makeProject(id: string, title: string): Project {
  return {
    id: ProjectId.make(id),
    title,
    color: null,
    archivedAt: null,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function makePage(
  id: string,
  title: string,
  body: string,
  overrides: Partial<Page> = {},
): Page {
  return {
    id: PageId.make(id),
    projectId,
    kind: "page",
    title,
    body,
    pinned: false,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    deletedAt: null,
    lastReason: null,
    ...overrides,
  };
}

describe("buildContext", () => {
  it("builds a global context with me brief, projects, and top open tasks", () => {
    const projects = new Map([[projectId, makeProject("p_AAAAAAA1", "App")]]);
    const tasks = new Map([
      [TaskId.make("t_AAAAAAA1"), makeTask("t_AAAAAAA1", "One", "d")],
      [TaskId.make("t_AAAAAAA2"), makeTask("t_AAAAAAA2", "Two", "m")],
    ]);
    const pages = new Map([
      [
        PageId.make("pg_AAAAAAA1"),
        makePage("pg_AAAAAAA1", "Me", "I care about focus.", {
          projectId: null,
          kind: "brief",
        }),
      ],
      [
        PageId.make("pg_AAAAAAA2"),
        makePage("pg_AAAAAAA2", "App brief", "Ship the MVP.", {
          kind: "brief",
        }),
      ],
    ]);

    const context = buildContext({
      today: "2026-10-06",
      projects,
      tasks,
      pages,
      chats: new Map(),
      projectId: null,
      chatId: null,
      tokenBudget: 10_000,
    });

    expect(context.scope).toBe("global");
    expect(context.meBrief).toBe("I care about focus.");
    expect(context.projectLines).toEqual([
      { id: projectId, title: "App", briefLine: "Ship the MVP." },
    ]);
    expect(context.tasks.map((task) => task.title)).toEqual(["One", "Two"]);
    expect(context.trimmed).toEqual({ tasks: 0, pages: 0 });
  });

  it("builds a project context with brief, pages, and chat summaries", () => {
    const chatId = ChatId.make("c_AAAAAAA1");
    const projects = new Map([[projectId, makeProject("p_AAAAAAA1", "App")]]);
    const tasks = new Map([
      [TaskId.make("t_AAAAAAA1"), makeTask("t_AAAAAAA1", "One", "d")],
    ]);
    const pages = new Map([
      [
        PageId.make("pg_AAAAAAA1"),
        makePage("pg_AAAAAAA1", "Brief", "Project goals.", { kind: "brief" }),
      ],
      [
        PageId.make("pg_AAAAAAA2"),
        makePage("pg_AAAAAAA2", "Notes", "First line\nSecond", { pinned: true }),
      ],
    ]);
    const chats = new Map<ChatId, Chat>([
      [
        chatId,
        {
          id: chatId,
          projectId,
          title: "Earlier",
          summary: "Talked about shipping.",
          messages: [
            { id: "m1", role: "user", text: "Hi", at: "2026-10-06T01:00:00.000Z" },
            { id: "m2", role: "assistant", text: "Hello", at: "2026-10-06T01:01:00.000Z" },
          ],
          createdAt: "2026-10-06T01:00:00.000Z",
          updatedAt: "2026-10-06T01:01:00.000Z",
        },
      ],
    ]);

    const context = buildContext({
      today: "2026-10-06",
      projects,
      tasks,
      pages,
      chats,
      projectId,
      chatId,
      tokenBudget: 10_000,
    });

    expect(context.scope).toBe("project");
    expect(context.projectBrief).toBe("Project goals.");
    expect(context.pages[0]?.body).toContain("First line");
    expect(context.chatSummaries[0]?.summary).toBe("Talked about shipping.");
    expect(context.recentMessages).toHaveLength(2);
  });

  it("trims tasks when over the token budget", () => {
    const projects = new Map([[projectId, makeProject("p_AAAAAAA1", "App")]]);
    const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const tasks = new Map(
      Array.from({ length: 20 }, (_, index) => {
        const suffix = crockford[index + 1]!.repeat(8);
        const task = makeTask(
          `t_${suffix}`,
          `Task ${index} ${"x".repeat(80)}`,
          String.fromCharCode(98 + (index % 24)),
        );
        return [task.id, task] as const;
      }),
    );

    const context = buildContext({
      today: "2026-10-06",
      projects,
      tasks,
      pages: new Map(),
      chats: new Map(),
      projectId: null,
      chatId: null,
      tokenBudget: 200,
    });

    expect(context.estimatedTokens).toBeLessThanOrEqual(200);
    expect(context.trimmed.tasks).toBeGreaterThan(0);
    expect(context.tasks.length).toBeLessThan(20);
  });
});
