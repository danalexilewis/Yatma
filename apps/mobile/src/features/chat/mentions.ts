import { formatRef, type FoldedEntities } from "@yatma/core";

export type ComposerSelection = { readonly start: number; readonly end: number };
export type MentionQuery = {
  readonly start: number;
  readonly end: number;
  readonly kind: "task" | "project" | null;
  readonly query: string;
};
export type MentionSuggestion = {
  readonly kind: "task" | "project";
  readonly id: string;
  readonly label: string;
  readonly context: string;
};

/** Finds the unfinished mention at the caret without treating email or persisted links as queries. */
export function findMentionQuery(text: string, selection: ComposerSelection): MentionQuery | null {
  if (selection.start !== selection.end || selection.start < 0 || selection.end > text.length)
    return null;
  const end = selection.end;
  for (const match of text.matchAll(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g)) {
    if (end > match.index && end <= match.index + match[0].length) return null;
  }
  const start = text.lastIndexOf("@", end - 1);
  if (start < 0 || (start > 0 && !/[\s([{]/.test(text[start - 1]!))) return null;
  const fragment = text.slice(start + 1, end);
  if (/[\n\r\[\](){}@]/.test(fragment)) return null;
  const typed = /^(task|project)(?:\s+|:|$)(.*)$/i.exec(fragment);
  return {
    start,
    end,
    kind: typed ? (typed[1]!.toLowerCase() as "task" | "project") : null,
    query: (typed ? typed[2]! : fragment).trim(),
  };
}

/** Suggestions identify committed entities by ID and expose context for duplicate titles. */
export function selectMentionSuggestions(
  state: Pick<FoldedEntities, "tasks" | "projects">,
  query: MentionQuery,
): MentionSuggestion[] {
  const suggestions: MentionSuggestion[] = [];
  if (query.kind !== "project") {
    for (const task of state.tasks.values()) {
      if (task.deletedAt !== null) continue;
      const project = task.projectId ? state.projects.get(task.projectId) : undefined;
      const status =
        task.status === "done"
          ? "Completed"
          : task.status === "in_progress"
            ? "In progress"
            : "To do";
      suggestions.push({
        kind: "task",
        id: task.id,
        label: task.title,
        context: ["Task", project?.title ?? "No project", status, task.id].join(" · "),
      });
    }
  }
  if (query.kind !== "task") {
    for (const project of state.projects.values()) {
      if (project.archivedAt !== null) continue;
      suggestions.push({
        kind: "project",
        id: project.id,
        label: project.title,
        context: `Project · ${project.id}`,
      });
    }
  }
  const terms = query.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return suggestions
    .filter((suggestion) =>
      terms.every((term) =>
        `${suggestion.label} ${suggestion.context}`.toLocaleLowerCase().includes(term),
      ),
    )
    .toSorted(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    );
}

/** Rechecks the current entity before replacing only the query span with an escaped durable ref. */
export function insertMention(
  text: string,
  query: MentionQuery,
  suggestion: MentionSuggestion,
  state: Pick<FoldedEntities, "tasks" | "projects">,
): { readonly text: string; readonly selection: ComposerSelection } | null {
  const currentQuery = findMentionQuery(text, { start: query.end, end: query.end });
  if (
    !currentQuery ||
    currentQuery.start !== query.start ||
    currentQuery.kind !== query.kind ||
    currentQuery.query !== query.query
  )
    return null;
  const current = selectMentionSuggestions(state, { ...currentQuery, query: "" }).find(
    (item) => item.kind === suggestion.kind && item.id === suggestion.id,
  );
  if (!current) return null;
  const ref = formatRef(current.kind, current.id, current.label);
  const separator = text[query.end] && /\s/.test(text[query.end]!) ? "" : " ";
  const prefix = text.slice(0, query.start) + ref + separator;
  return {
    text: prefix + text.slice(query.end),
    selection: { start: prefix.length, end: prefix.length },
  };
}

/** Infers the caret for controlled edits before the platform's selection event arrives. */
export function selectionAfterTextChange(
  previous: string,
  next: string,
  selection: ComposerSelection,
): ComposerSelection {
  const start = Math.min(selection.start, previous.length);
  const end = Math.min(selection.end, previous.length);
  const inserted = next.length - previous.length + end - start;
  let caret: number;
  if (
    inserted >= 0 &&
    previous.slice(0, start) === next.slice(0, start) &&
    previous.slice(end) === next.slice(start + inserted)
  ) {
    caret = start + inserted;
  } else if (
    inserted < 0 &&
    start + inserted >= 0 &&
    previous.slice(0, start + inserted) === next.slice(0, start + inserted) &&
    previous.slice(end) === next.slice(start + inserted)
  ) {
    caret = start + inserted;
  } else if (
    inserted < 0 &&
    previous.slice(0, start) === next.slice(0, start) &&
    previous.slice(end - inserted) === next.slice(start)
  ) {
    caret = start;
  } else {
    let suffix = 0;
    while (
      suffix < previous.length &&
      suffix < next.length &&
      previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
    )
      suffix++;
    caret = next.length - suffix;
  }
  return { start: caret, end: caret };
}
