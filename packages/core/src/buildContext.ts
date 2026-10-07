// Copyright (c) T3 Tools / MIT — adapted for Yatma
import type { ChatId, ProjectId } from "./ids.ts";
import type { Chat, Page, Project, Task } from "./schemas.ts";
import { selectDoingSummary, selectNowList } from "./selectors.ts";
import { isOpenTask, sortTasksByPosition } from "./rules.ts";

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
  readonly projectLines: readonly { readonly id: ProjectId; readonly title: string; readonly briefLine: string }[];
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

function findBrief(
  pages: ReadonlyMap<PageIdLike, Page>,
  projectId: ProjectId | null,
): Page | null {
  for (const page of pages.values()) {
    if (page.kind !== "brief" || page.deletedAt !== null) continue;
    if (page.projectId === projectId) return page;
  }
  return null;
}

function compactTaskLine(task: Task, projects: ReadonlyMap<ProjectId, Project>): ContextTaskLine {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    quadrant: task.quadrant,
    projectId: task.projectId,
    projectTitle: projectTitleOf(task.projectId, projects),
  };
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
          .map((project) => `- ${project.title} (${project.id}): ${project.briefLine || "(no brief)"}`)
          .join("\n"),
    );
  }
  if (parts.tasks.length > 0) {
    chunks.push(
      "Tasks:\n" +
        parts.tasks
          .map((task) => {
            const project = task.projectTitle ? ` [${task.projectTitle}]` : "";
            const quadrant = task.quadrant ? ` ${task.quadrant}` : " inbox";
            return `- ${task.id} (${task.status}${quadrant})${project}: ${task.title}`;
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
 * Pure agent context builder. Trims tasks and the page index first when over budget.
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
    .slice(-RECENT_MESSAGE_CAP)
    .map((message) => ({ role: message.role, text: message.text }));

  if (input.projectId === null) {
    const open = selectNowList(allTasks).slice(0, GLOBAL_TASK_CAP);
    let tasks = open.map((task) => compactTaskLine(task, input.projects));
    const projectLines = [...input.projects.values()]
      .filter((project) => project.archivedAt === null)
      .map((project) => {
        const brief = findBrief(input.pages, project.id);
        return {
          id: project.id,
          title: project.title,
          briefLine: brief ? firstLine(brief.body) : "",
        };
      })
      .toSorted((a, b) => a.title.localeCompare(b.title));

    let trimmedTasks = 0;
    let estimated = estimateTokens(
      serializeContext({
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
      }),
    );

    while (estimated > input.tokenBudget && tasks.length > 0) {
      tasks = tasks.slice(0, -1);
      trimmedTasks += 1;
      estimated = estimateTokens(
        serializeContext({
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
        }),
      );
    }

    return {
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
      estimatedTokens: estimated,
      trimmed: { tasks: trimmedTasks, pages: 0 },
    };
  }

  const projectBriefPage = findBrief(input.pages, input.projectId);
  const projectBrief = projectBriefPage?.body ?? null;
  const projectOpen = sortTasksByPosition(allTasks)
    .filter((task) => isOpenTask(task) && task.projectId === input.projectId)
    .slice(0, PROJECT_TASK_CAP);
  let tasks = projectOpen.map((task) => compactTaskLine(task, input.projects));

  const projectPages = [...input.pages.values()]
    .filter((page) => page.deletedAt === null && page.projectId === input.projectId && page.kind === "page")
    .toSorted((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.title.localeCompare(b.title);
    });

  let pages: ContextPageLine[] = projectPages.map((page) => ({
    id: page.id,
    title: page.title,
    pinned: page.pinned,
    firstLine: firstLine(page.body),
    body: page.pinned ? page.body : null,
  }));

  const chatSummaries = [...input.chats.values()]
    .filter((chat) => chat.projectId === input.projectId)
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, RECENT_CHAT_SUMMARY_CAP)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      summary: chat.summary,
    }));

  let trimmedTasks = 0;
  let trimmedPages = 0;
  let estimated = estimateTokens(
    serializeContext({
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
    }),
  );

  while (estimated > input.tokenBudget && (tasks.length > 0 || pages.some((page) => page.body === null))) {
    if (pages.some((page) => page.body === null)) {
      const index = pages.findLastIndex((page) => page.body === null);
      pages = pages.filter((_, i) => i !== index);
      trimmedPages += 1;
    } else if (tasks.length > 0) {
      tasks = tasks.slice(0, -1);
      trimmedTasks += 1;
    } else {
      break;
    }
    estimated = estimateTokens(
      serializeContext({
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
      }),
    );
  }

  // If still over budget, drop pinned page bodies (keep titles).
  while (estimated > input.tokenBudget && pages.some((page) => page.body !== null)) {
    pages = pages.map((page) => (page.body !== null ? { ...page, body: null } : page));
    trimmedPages += 1;
    estimated = estimateTokens(
      serializeContext({
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
      }),
    );
  }

  return {
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
    estimatedTokens: estimated,
    trimmed: { tasks: trimmedTasks, pages: trimmedPages },
  };
}
