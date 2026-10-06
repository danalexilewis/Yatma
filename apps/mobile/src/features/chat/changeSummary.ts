import type { Event } from "@yatma/core";

import type { ChangeSummary } from "./ChangeCard";

/** Build a ChangeCard summary from a Changes stream batch. */
export function summarizeChangeEvents(
  events: readonly Event[],
  fallbackRows: ReadonlyArray<{ readonly label: string }> = [],
): ChangeSummary {
  let added = 0;
  let completed = 0;
  let moved = 0;
  let updated = 0;
  const rows: Array<{ readonly label: string }> = [...fallbackRows];

  for (const event of events) {
    if (event.type === "task.created") {
      added += 1;
      rows.push({ label: `+ ${event.title}` });
      continue;
    }
    if (event.type === "task.updated") {
      if (event.set.status === "done") {
        completed += 1;
        rows.push({ label: `✓ ${event.taskId}` });
      } else if (event.set.position !== undefined) {
        moved += 1;
        rows.push({ label: `↕ ${event.taskId}` });
      } else {
        updated += 1;
        rows.push({ label: `~ ${event.taskId}` });
      }
      continue;
    }
    if (event.type === "project.created") {
      added += 1;
      rows.push({ label: `+ project ${event.title}` });
      continue;
    }
    if (event.type === "page.created" || event.type === "page.updated") {
      updated += 1;
      rows.push({
        label:
          event.type === "page.created"
            ? `page ${event.title}`
            : `page ${event.pageId}`,
      });
      continue;
    }
    if (event.type === "chat.updated") {
      updated += 1;
      rows.push({ label: "Handbook / chat updated" });
    }
  }

  return { added, completed, moved, updated, rows };
}
