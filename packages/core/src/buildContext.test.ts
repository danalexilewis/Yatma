// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import { buildContext, contextText } from "./buildContext.ts";
import { ChatId, DeviceId, PageId, ProjectId, TaskId } from "./ids.ts";
import type { Chat, Page, Project, Task } from "./schemas.ts";

const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };
const projectId = ProjectId.make("p_AAAAAAA1");

function makeTask(
  id: string,
  title: string,
  position: string,
  overrides: Partial<Task> = {},
): Task {
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

function makePage(id: string, title: string, body: string, overrides: Partial<Page> = {}): Page {
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
  it("shares project properties, bookmarks, task dates, and personal matrix labels with the model", () => {
    const project = {
      ...makeProject("p_AAAAAAA1", "App"),
      description: "Ship a calm task experience",
      targetDate: "2026-12-01",
      bookmarks: [{ title: "Design", url: "https://example.com/design" }],
    };
    const task = makeTask("t_AAAAAAA1", "Review dates", "n", {
      quadrant: "delegate",
      dueDate: "2026-10-20",
    });
    const built = buildContext({
      today: "2026-10-15",
      projects: new Map([[project.id, project]]),
      tasks: new Map([[task.id, task]]),
      pages: new Map(),
      chats: new Map(),
      projectId: project.id,
      chatId: null,
      tokenBudget: 6000,
    });
    const text = contextText(built);
    expect(text).toContain("Ship a calm task experience");
    expect(text).toContain("Target date: 2026-12-01");
    expect(text).toContain("Bookmark: Design (https://example.com/design)");
    expect(text).toContain("Urgent, not important; due 2026-10-20");
    expect(text).not.toContain("delegate");
  });
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
    const tasks = new Map([[TaskId.make("t_AAAAAAA1"), makeTask("t_AAAAAAA1", "One", "d")]]);
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

  it("bounds briefs, pinned bodies, summaries, and active messages in the shared model/preview text", () => {
    const chatId = ChatId.make("c_AAAAAAA1");
    const huge = "important context ".repeat(2_000);
    const projectBrief = makePage("pg_AAAAAAA1", "Brief", huge, { kind: "brief" });
    const pinnedPage = makePage("pg_AAAAAAA2", "Pinned reference", huge, { pinned: true });
    const chat: Chat = {
      id: chatId,
      projectId,
      title: "Active chat",
      summary: huge,
      messages: [
        { id: "old", role: "user", text: huge, at: "2026-10-06T01:00:00.000Z" },
        {
          id: "latest",
          role: "assistant",
          text: `latest answer ${huge}`,
          at: "2026-10-06T01:01:00.000Z",
        },
      ],
      createdAt: "2026-10-06T01:00:00.000Z",
      updatedAt: "2026-10-06T01:01:00.000Z",
    };
    const context = buildContext({
      today: "2026-10-06",
      projects: new Map([[projectId, makeProject("p_AAAAAAA1", "App")]]),
      tasks: new Map(),
      pages: new Map([
        [projectBrief.id, projectBrief],
        [pinnedPage.id, pinnedPage],
      ]),
      chats: new Map([[chatId, chat]]),
      projectId,
      chatId,
      tokenBudget: 220,
    });

    const previewText = contextText(context);
    expect(context.estimatedTokens).toBe(Math.ceil(previewText.length / 4));
    expect(context.estimatedTokens).toBeLessThanOrEqual(220);
    expect(previewText.length).toBeLessThanOrEqual(220 * 4);
    expect(previewText).toContain("Pinned reference");
    expect(previewText).toContain("latest answer");
    expect(context.pages.find((page) => page.pinned)?.body).not.toBeNull();
  });

  it("bounds global brief excerpts and project brief lines", () => {
    const meBrief = makePage("pg_AAAAAAA1", "Me", "personal guidance ".repeat(2_000), {
      projectId: null,
      kind: "brief",
    });
    const projectBrief = makePage("pg_AAAAAAA2", "App brief", "project guidance ".repeat(2_000), {
      kind: "brief",
    });
    const context = buildContext({
      today: "2026-10-06",
      projects: new Map([[projectId, makeProject("p_AAAAAAA1", "App")]]),
      tasks: new Map(),
      pages: new Map([
        [meBrief.id, meBrief],
        [projectBrief.id, projectBrief],
      ]),
      chats: new Map(),
      projectId: null,
      chatId: null,
      tokenBudget: 100,
    });

    const text = contextText(context);
    expect(context.estimatedTokens).toBe(Math.ceil(text.length / 4));
    expect(context.estimatedTokens).toBeLessThanOrEqual(100);
    expect(text.length).toBeLessThanOrEqual(400);
  });

  it("keeps only the fixed headings when the requested budget is below their size", () => {
    const context = buildContext({
      today: "2026-10-06",
      projects: new Map(),
      tasks: new Map(),
      pages: new Map(),
      chats: new Map(),
      projectId: null,
      chatId: null,
      tokenBudget: 1,
    });
    expect(contextText(context)).toBe("Today: 2026-10-06\n\nDoing: ");
    expect(context.estimatedTokens).toBe(Math.ceil(contextText(context).length / 4));
  });
});
