import { addCalendarDays, scheduledDateForPreset } from "./dates.ts";
import type { Task } from "./schemas.ts";

export type TaskCatalogFilter = {
  readonly query: string;
  readonly status: "all" | "open" | "done" | "deleted";
  readonly projectId?: string | null;
  readonly due: "all" | "today" | "upcoming" | "overdue" | "undated";
  readonly scheduled?: "all" | "today" | "this_week" | "next_week" | "later";
  readonly today: string;
  readonly sort: "priority" | "title" | "scheduled" | "due" | "updated";
};

/** Global task browsing includes unassigned tasks and tasks in archived projects. */
export function selectTaskCatalog(tasks: readonly Task[], filter: TaskCatalogFilter): Task[] {
  const query = filter.query.trim().toLocaleLowerCase();
  const sunday = scheduledDateForPreset(filter.today, "this_week")!;
  const nextMonday = addCalendarDays(sunday, 1);
  function matchesSchedule(task: Task): boolean {
    const date = task.scheduledDate ?? null;
    switch (filter.scheduled) {
      case "today":
        return date === filter.today;
      case "this_week":
        return date !== null && date >= addCalendarDays(sunday, -6) && date <= sunday;
      case "next_week":
        return date !== null && date >= nextMonday && date <= addCalendarDays(nextMonday, 6);
      case "later":
        return date === null || date > addCalendarDays(nextMonday, 6);
      default:
        return true;
    }
  }
  return tasks
    .filter(
      (task) =>
        (filter.status === "deleted" ? task.deletedAt !== null : task.deletedAt === null) &&
        (filter.status === "open"
          ? task.status !== "done"
          : filter.status === "done"
            ? task.status === "done"
            : true) &&
        (filter.projectId === undefined || task.projectId === filter.projectId) &&
        matchesSchedule(task) &&
        (!query || `${task.title} ${task.notes}`.toLocaleLowerCase().includes(query)) &&
        (filter.due === "all" ||
          (filter.due === "undated"
            ? task.dueDate === null
            : task.dueDate !== null &&
              (filter.due === "today"
                ? task.dueDate === filter.today
                : filter.due === "upcoming"
                  ? task.dueDate >= filter.today && task.dueDate <= addCalendarDays(filter.today, 7)
                  : task.dueDate < filter.today))),
    )
    .toSorted((a, b) => {
      const result =
        filter.sort === "title"
          ? a.title.localeCompare(b.title)
          : filter.sort === "scheduled"
            ? (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999")
            : filter.sort === "due"
              ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
              : filter.sort === "updated"
                ? b.updatedAt.localeCompare(a.updatedAt)
                : compareTaskPriority(a, b, filter.today);
      return result || a.id.localeCompare(b.id);
    });
}

/** Deadlines today/overdue first, then importance, deadline and schedule; manual order breaks ties. */
export function compareTaskPriority(a: Task, b: Task, today: string): number {
  const urgentA = a.dueDate !== null && a.dueDate <= today;
  const urgentB = b.dueDate !== null && b.dueDate <= today;
  if (urgentA !== urgentB) return urgentA ? -1 : 1;
  const ranks = { high: 0, medium: 1, low: 2 };
  const rank = (a.priority ? ranks[a.priority] : 3) - (b.priority ? ranks[b.priority] : 3);
  if (rank) return rank;
  const deadline = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  if (deadline) return deadline;
  const scheduled = (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999");
  if (scheduled) return scheduled;
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}
