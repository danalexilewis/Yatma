// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { ChatId, ProjectId } from "./ids.ts";
import type { Chat, Page, Project, Task } from "./schemas.ts";
import { selectDoingSummary, selectNowList } from "./selectors.ts";
import { isOpenTask, sortTasksByPosition } from "./rules.ts";
import { quadrantLabel } from "./matrix.ts";

export type BuildContextInput = {
  readonly today: string;
  readonly projects: ReadonlyMap<ProjectId, Project>;
  readonly tasks: ReadonlyMap<TaskIdLike, Task>;
  readonly pages: ReadonlyMap<PageIdLike, Page>;
  readonly chats: ReadonlyMap<ChatId, Chat>;
  /** Null scopes the context to global chat; otherwise to one project. */
  readonly projectId: ProjectId | null;
  /** Active chat whose recent messages/summary are included. */
  readonly chatId: ChatId | null;
  /** Approximate token budget for the whole context block. */
  readonly tokenBudget: number;
};

type TaskIdLike = Task["id"];
type PageIdLike = Page["id"];

export type ContextTaskLine = {
  readonly id: TaskIdLike;
  readonly title: string;
  readonly status: Task["status"];
  readonly quadrant: Task["quadrant"];
  readonly dueDate: Task["dueDate"];
  readonly projectId: ProjectId | null;
  readonly projectTitle: string | null;
};

export type ContextPageLine = {
  readonly id: PageIdLike;
  readonly title: string;
  readonly pinned: boolean;
  readonly firstLine: string;
  readonly body: string | null;
};

export type ContextChatSummary = {
  readonly id: ChatId;
  readonly title: string | null;
  readonly summary: string | null;
};

export type BuiltContext = {
  readonly scope: "global" | "project";
  readonly today: string;
  readonly meBrief: string | null;
  readonly projectBrief: string | null;
  readonly projectLines: readonly {
    readonly id: ProjectId;
    readonly title: string;
    readonly briefLine: string;
  }[];
  readonly tasks: readonly ContextTaskLine[];
  readonly pages: readonly ContextPageLine[];
  readonly chatSummaries: readonly ContextChatSummary[];
  readonly doingSummary: string;
  readonly conversationSummary: string | null;
  readonly recentMessages: readonly { readonly role: string; readonly text: string }[];
  readonly estimatedTokens: number;
  readonly trimmed: { readonly tasks: number; readonly pages: number };
};

const CHARS_PER_TOKEN = 4;
const GLOBAL_TASK_CAP = 30;
const PROJECT_TASK_CAP = 60;
const RECENT_MESSAGE_CAP = 12;
const RECENT_CHAT_SUMMARY_CAP = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function fitContextBudget(context: BuiltContext, requestedBudget: number): BuiltContext {
  const budget = Number.isFinite(requestedBudget) ? Math.max(0, Math.floor(requestedBudget)) : 0;
  const fieldLimit = Math.max(1, Math.floor(budget * CHARS_PER_TOKEN * 0.25));
  function cap(value: string | null): string | null {
    if (value === null || value.length <= fieldLimit) return value;
    return `${value.slice(0, Math.max(0, fieldLimit - 1)).trimEnd()}…`;
  }
  let meBrief = cap(context.meBrief);
  let projectBrief = cap(context.projectBrief);
  let projectLines = context.projectLines.map((line) => ({
    ...line,
    briefLine: cap(line.briefLine) ?? "",
  }));
  let tasks = context.tasks.map((task) => ({ ...task, title: cap(task.title) ?? "" }));
  let pages = context.pages.map((page) => ({
    ...page,
    firstLine: cap(page.firstLine) ?? "",
    body: cap(page.body),
  }));
  let chatSummaries = context.chatSummaries.map((chat) => ({
    ...chat,
    summary: cap(chat.summary),
  }));
  let conversationSummary = cap(context.conversationSummary);
  let recentMessages = context.recentMessages.map((message) => ({
    ...message,
    text: cap(message.text) ?? "",
  }));
  let doingSummary = context.doingSummary;
  let trimmedTasks = context.trimmed.tasks;
  let trimmedPages =
    context.trimmed.pages +
    context.pages.filter((page) => page.body !== null && page.body.length > fieldLimit).length;

  function current(): BuiltContext {
    const built = {
      ...context,
      meBrief,
      projectBrief,
      projectLines,
      tasks,
      pages,
      chatSummaries,
      conversationSummary,
      recentMessages,
      doingSummary,
      estimatedTokens: 0,
      trimmed: { tasks: trimmedTasks, pages: trimmedPages },
    };
    return { ...built, estimatedTokens: estimateTokens(contextText(built)) };
  }

  function overBudget(): number {
    return Math.max(0, contextText(current()).length - budget * CHARS_PER_TOKEN);
  }

  function shrink(value: string, set: (next: string) => void): void {
    const excess = overBudget();
    if (excess <= 0 || value.length === 0) return;
    const nextLength = Math.max(0, value.length - excess - 1);
    set(nextLength === 0 ? "" : `${value.slice(0, nextLength).trimEnd()}…`);
  }

  function removeLast<T>(items: T[], set: (next: T[]) => void, onTrim?: () => void): void {
    if (items.length === 0) return;
    set(items.slice(0, -1));
    onTrim?.();
  }

  // Broad indexes and secondary summaries give way before scope-defining material.
  while (overBudget() > 0 && chatSummaries.length > 1)
    removeLast(chatSummaries, (next) => {
      chatSummaries = next;
    });
  while (overBudget() > 0 && pages.some((page) => !page.pinned)) {
    const index = pages.findLastIndex((page) => !page.pinned);
    pages = pages.filter((_, itemIndex) => itemIndex !== index);
    trimmedPages += 1;
  }
  while (overBudget() > 0 && tasks.length > 0)
    removeLast(
      tasks,
      (next) => {
        tasks = next;
      },
      () => {
        trimmedTasks += 1;
      },
    );
  while (overBudget() > 0 && chatSummaries.length > 0)
    removeLast(chatSummaries, (next) => {
      chatSummaries = next;
    });

  if (overBudget() > 0 && conversationSummary !== null) {
    shrink(conversationSummary, (next) => {
      conversationSummary = next || null;
    });
  }
  if (overBudget() > 0 && projectBrief !== null)
    shrink(projectBrief, (next) => {
      projectBrief = next || null;
    });
  if (overBudget() > 0 && meBrief !== null)
    shrink(meBrief, (next) => {
      meBrief = next || null;
    });
  if (overBudget() > 0 && projectLines.length > 0) {
    for (let index = 0; index < projectLines.length && overBudget() > 0; index += 1) {
      const line = projectLines[index]!;
      let briefLine = line.briefLine;
      shrink(briefLine, (next) => {
        briefLine = next;
      });
      projectLines[index] = { ...line, briefLine };
    }
  }
  while (overBudget() > 0 && projectLines.length > 0)
    removeLast(projectLines, (next) => {
      projectLines = next;
    });
  if (overBudget() > 0 && pages.length > 0) {
    for (let index = 0; index < pages.length && overBudget() > 0; index += 1) {
      const page = pages[index]!;
      let firstLine = page.firstLine;
      if (overBudget() > 0)
        shrink(firstLine, (next) => {
          firstLine = next;
        });
      pages[index] = { ...page, firstLine };
    }
  }
  if (overBudget() > 0 && recentMessages.length > 1) {
    const keep = Math.max(1, recentMessages.length - Math.ceil(overBudget() / 32));
    recentMessages = recentMessages.slice(-keep);
  }
  if (overBudget() > 0 && recentMessages.length > 0) {
    const last = recentMessages.at(-1)!;
    let text = last.text;
    shrink(text, (next) => {
      text = next;
    });
    recentMessages = [...recentMessages.slice(0, -1), { ...last, text }];
  }
  if (overBudget() > 0 && tasks.length > 0) {
    for (let index = 0; index < tasks.length && overBudget() > 0; index += 1) {
      const task = tasks[index]!;
      let title = task.title;
      shrink(title, (next) => {
        title = next;
      });
      tasks[index] = { ...task, title };
    }
  }
  if (overBudget() > 0)
    shrink(doingSummary, (next) => {
      doingSummary = next;
    });

  // Chat summaries are lower priority than the active conversation, but still bounded.
  if (overBudget() > 0 && chatSummaries.length > 0) {
    for (let index = 0; index < chatSummaries.length && overBudget() > 0; index += 1) {
      const chat = chatSummaries[index]!;
      let summary = chat.summary;
      if (summary !== null)
        shrink(summary, (next) => {
          summary = next || null;
        });
      chatSummaries[index] = { ...chat, summary };
    }
  }

  // Pinned bodies are the highest-priority reference material, after the active message.
  if (overBudget() > 0 && pages.some((page) => page.body !== null)) {
    for (let index = 0; index < pages.length && overBudget() > 0; index += 1) {
      const page = pages[index]!;
      if (page.body === null) continue;
      let body = page.body;
      shrink(body, (next) => {
        body = next || "";
      });
      trimmedPages += 1;
      pages[index] = { ...page, body: body || null };
    }
  }

  // Bound pathological identifiers/titles while retaining the mandatory base headings.
  if (overBudget() > 0) {
    projectLines = projectLines.map((line) => ({ ...line, title: line.title.slice(0, 80) }));
    pages = pages.map((page) => ({ ...page, title: page.title.slice(0, 80) }));
    tasks = tasks.map((task) => ({
      ...task,
      projectTitle: task.projectTitle?.slice(0, 80) ?? null,
    }));
  }
  if (overBudget() > 0) {
    meBrief = null;
    projectBrief = null;
    projectLines = [];
    tasks = [];
    pages = [];
    chatSummaries = [];
    conversationSummary = null;
    recentMessages = [];
    doingSummary = "";
  }
  return current();
}

function firstLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim().length > 0);
  return line?.trim() ?? "";
}

function projectTitleOf(
  projectId: ProjectId | null,
  projects: ReadonlyMap<ProjectId, Project>,
): string | null {
  if (projectId === null) return null;
  return projects.get(projectId)?.title ?? null;
}

function findBrief(pages: ReadonlyMap<PageIdLike, Page>, projectId: ProjectId | null): Page | null {
  return (
    [...pages.values()]
      .filter(
        (page) => page.kind === "brief" && page.deletedAt === null && page.projectId === projectId,
      )
      .toSorted((a, b) => a.id.localeCompare(b.id))[0] ?? null
  );
}

function compactTaskLine(task: Task, projects: ReadonlyMap<ProjectId, Project>): ContextTaskLine {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    quadrant: task.quadrant,
    dueDate: task.dueDate,
    projectId: task.projectId,
    projectTitle: projectTitleOf(task.projectId, projects),
  };
}

function projectProperties(project: Project | undefined): string {
  if (!project) return "";
  return [
    project.description ? `Purpose: ${project.description}` : "",
    project.targetDate ? `Target date: ${project.targetDate}` : "",
    ...(project.bookmarks ?? []).map((bookmark) => `Bookmark: ${bookmark.title} (${bookmark.url})`),
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeContext(parts: {
  readonly today: string;
  readonly meBrief: string | null;
  readonly projectBrief: string | null;
  readonly projectLines: BuiltContext["projectLines"];
  readonly tasks: readonly ContextTaskLine[];
  readonly pages: readonly ContextPageLine[];
  readonly chatSummaries: readonly ContextChatSummary[];
  readonly doingSummary: string;
  readonly conversationSummary: string | null;
  readonly recentMessages: readonly { readonly role: string; readonly text: string }[];
}): string {
  const chunks: string[] = [`Today: ${parts.today}`, `Doing: ${parts.doingSummary}`];
  if (parts.meBrief) chunks.push(`Me brief:\n${parts.meBrief}`);
  if (parts.projectBrief) chunks.push(`Project brief:\n${parts.projectBrief}`);
  if (parts.projectLines.length > 0) {
    chunks.push(
      "Projects:\n" +
        parts.projectLines
          .map(
            (project) => `- ${project.title} (${project.id}): ${project.briefLine || "(no brief)"}`,
          )
          .join("\n"),
    );
  }
  if (parts.tasks.length > 0) {
    chunks.push(
      "Tasks:\n" +
        parts.tasks
          .map((task) => {
            const project = task.projectTitle ? ` [${task.projectTitle}]` : "";
            const quadrant = quadrantLabel(task.quadrant);
            const dueDate = task.dueDate ? `; due ${task.dueDate}` : "; no due date";
            return `- ${task.id} (${task.status}; ${quadrant}${dueDate})${project}: ${task.title}`;
          })
          .join("\n"),
    );
  }
  if (parts.pages.length > 0) {
    chunks.push(
      "Pages:\n" +
        parts.pages
          .map((page) => {
            if (page.body !== null) return `## ${page.title}\n${page.body}`;
            return `- ${page.id}${page.pinned ? " [pinned]" : ""}: ${page.title} — ${page.firstLine}`;
          })
          .join("\n"),
    );
  }
  if (parts.chatSummaries.length > 0) {
    chunks.push(
      "Recent chats:\n" +
        parts.chatSummaries
          .map((chat) => `- ${chat.title ?? chat.id}: ${chat.summary ?? "(no summary)"}`)
          .join("\n"),
    );
  }
  if (parts.conversationSummary) chunks.push(`Conversation summary:\n${parts.conversationSummary}`);
  if (parts.recentMessages.length > 0) {
    chunks.push(
      "Recent messages:\n" +
        parts.recentMessages.map((message) => `${message.role}: ${message.text}`).join("\n"),
    );
  }
  return chunks.join("\n\n");
}

/** Serialize a built context to the exact text the model and Context tab share. */
export function contextText(built: BuiltContext): string {
  return serializeContext({
    today: built.today,
    meBrief: built.meBrief,
    projectBrief: built.projectBrief,
    projectLines: built.projectLines,
    tasks: built.tasks,
    pages: built.pages,
    chatSummaries: built.chatSummaries,
    doingSummary: built.doingSummary,
    conversationSummary: built.conversationSummary,
    recentMessages: built.recentMessages,
  });
}

/**
 * Pure agent context builder. Every serialized field shares one deterministic budget.
 * The phone Context tab should render this exact output.
 */
export function buildContext(input: BuildContextInput): BuiltContext {
  const allTasks = [...input.tasks.values()];
  const doing = selectDoingSummary(allTasks, input.projects);
  const doingSummary =
    doing.count === 0
      ? "nothing in progress"
      : `${doing.count} doing across ${doing.projectCount} project${doing.projectCount === 1 ? "" : "s"}`;

  const meBriefPage = findBrief(input.pages, null);
  const meBrief = meBriefPage?.body ?? null;

  const activeChat = input.chatId ? (input.chats.get(input.chatId) ?? null) : null;
  const conversationSummary = activeChat?.summary ?? null;
  const recentMessages = (activeChat?.messages ?? [])
    .toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .slice(-RECENT_MESSAGE_CAP)
    .map((message) => ({ role: message.role, text: message.text }));

  if (input.projectId === null) {
    const open = selectNowList(allTasks).slice(0, GLOBAL_TASK_CAP);
    const tasks = open.map((task) => compactTaskLine(task, input.projects));
    const projectLines = [...input.projects.values()]
      .filter((project) => project.archivedAt === null)
      .map((project) => {
        const brief = findBrief(input.pages, project.id);
        return {
          id: project.id,
          title: project.title,
          briefLine: [projectProperties(project), brief ? firstLine(brief.body) : ""]
            .filter(Boolean)
            .join("\n"),
        };
      })
      .toSorted((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

    return fitContextBudget(
      {
        scope: "global",
        today: input.today,
        meBrief,
        projectBrief: null,
        projectLines,
        tasks,
        pages: [],
        chatSummaries: [],
        doingSummary,
        conversationSummary,
        recentMessages,
        estimatedTokens: 0,
        trimmed: { tasks: 0, pages: 0 },
      },
      input.tokenBudget,
    );
  }

  const projectBriefPage = findBrief(input.pages, input.projectId);
  const projectBrief =
    [projectProperties(input.projects.get(input.projectId)), projectBriefPage?.body]
      .filter(Boolean)
      .join("\n\n") || null;
  const projectOpen = sortTasksByPosition(allTasks)
    .filter((task) => isOpenTask(task) && task.projectId === input.projectId)
    .slice(0, PROJECT_TASK_CAP);
  let tasks = projectOpen.map((task) => compactTaskLine(task, input.projects));

  const projectPages = [...input.pages.values()]
    .filter(
      (page) =>
        page.deletedAt === null && page.projectId === input.projectId && page.kind === "page",
    )
    .toSorted((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });

  let pages: ContextPageLine[] = projectPages.map((page) => ({
    id: page.id,
    title: page.title,
    pinned: page.pinned,
    firstLine: firstLine(page.body),
    body: page.pinned ? page.body : null,
  }));

  const orderedChats = [...input.chats.values()]
    .filter((chat) => chat.projectId === input.projectId)
    .toSorted((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id),
    );
  const activeSummary = activeChat?.projectId === input.projectId ? activeChat : null;
  const chatSummaries = [
    ...(activeSummary ? [activeSummary] : []),
    ...orderedChats.filter((chat) => chat.id !== activeSummary?.id),
  ]
    .slice(0, RECENT_CHAT_SUMMARY_CAP)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      summary: chat.summary,
    }));

  return fitContextBudget(
    {
      scope: "project",
      today: input.today,
      meBrief: null,
      projectBrief,
      projectLines: [],
      tasks,
      pages,
      chatSummaries,
      doingSummary,
      conversationSummary,
      recentMessages,
      estimatedTokens: 0,
      trimmed: { tasks: 0, pages: 0 },
    },
    input.tokenBudget,
  );
}
