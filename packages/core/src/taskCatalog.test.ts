import { expect, it } from "vite-plus/test";
import { DeviceId, ProjectId, TaskId } from "./ids.ts";
import { selectTaskCatalog, type TaskCatalogFilter } from "./taskCatalog.ts";
import type { Task } from "./schemas.ts";
const base: Task = {
  id: TaskId.make("t_AAAAAAA1"),
  title: "Unassigned",
  projectId: null,
  notes: "",
  dueDate: null,
  status: "todo",
  quadrant: null,
  position: "A",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  createdBy: { kind: "user", deviceId: DeviceId.make("test") },
  completedAt: null,
  deletedAt: null,
  lastReason: null,
};
const tasks: Task[] = [
  base,
  {
    ...base,
    id: TaskId.make("t_AAAAAAA2"),
    title: "Project work",
    projectId: ProjectId.make("p_AAAAAAA1"),
    dueDate: "2026-11-10",
    position: "a",
  },
  {
    ...base,
    id: TaskId.make("t_AAAAAAA3"),
    title: "Completed",
    status: "done",
    dueDate: "2026-11-12",
  },
  { ...base, id: TaskId.make("t_AAAAAAA4"), title: "Deleted", deletedAt: base.updatedAt },
];
const filter: TaskCatalogFilter = {
  query: "",
  status: "open",
  due: "all",
  sort: "priority",
  today: "2026-11-11",
};
it("includes unassigned tasks alongside project tasks, preserving priority order", () => {
  expect(selectTaskCatalog(tasks, filter).map((task) => task.title)).toEqual([
    "Project work",
    "Unassigned",
  ]);
  expect(selectTaskCatalog(tasks, { ...filter, projectId: null }).map((task) => task.id)).toEqual([
    base.id,
  ]);
  expect(selectTaskCatalog(tasks, { ...filter, status: "all" })).toHaveLength(3);
});
it("combines status, date, project and search filters without losing recovery views", () => {
  expect(selectTaskCatalog(tasks, { ...filter, query: "project", due: "overdue" })).toEqual([
    tasks[1],
  ]);
  expect(selectTaskCatalog(tasks, { ...filter, status: "done", due: "upcoming" })).toEqual([
    tasks[2],
  ]);
  expect(selectTaskCatalog(tasks, { ...filter, status: "deleted" })).toEqual([tasks[3]]);
  expect(selectTaskCatalog(tasks, { ...filter, projectId: "p_AAAAAAA1", due: "undated" })).toEqual(
    [],
  );
});
it("puts undated tasks last for date sorting and sorts titles independently of priority", () => {
  expect(selectTaskCatalog(tasks, { ...filter, sort: "due" }).map((task) => task.title)).toEqual([
    "Project work",
    "Unassigned",
  ]);
  expect(selectTaskCatalog(tasks, { ...filter, sort: "title" }).map((task) => task.title)).toEqual([
    "Project work",
    "Unassigned",
  ]);
});

it("prioritises real deadlines, then importance, with schedule and manual-order tie breaks", () => {
  const candidates: Task[] = [
    {
      ...base,
      id: TaskId.make("t_AAAAAAB1"),
      title: "Scheduled high",
      priority: "high",
      scheduledDate: "2026-11-11",
    },
    {
      ...base,
      id: TaskId.make("t_AAAAAAB2"),
      title: "Deadline",
      priority: "low",
      dueDate: "2026-11-10",
    },
    { ...base, id: TaskId.make("t_AAAAAAB3"), title: "High later", priority: "high" },
    {
      ...base,
      id: TaskId.make("t_AAAAAAB4"),
      title: "Low today",
      priority: "low",
      scheduledDate: "2026-11-11",
    },
  ];
  expect(selectTaskCatalog(candidates, filter).map((task) => task.title)).toEqual([
    "Deadline",
    "Scheduled high",
    "High later",
    "Low today",
  ]);
  expect(
    selectTaskCatalog(candidates, { ...filter, due: "overdue" }).map((task) => task.title),
  ).toEqual(["Deadline"]);
  expect(
    selectTaskCatalog(candidates, { ...filter, scheduled: "today" }).map((task) => task.title),
  ).toEqual(["Scheduled high", "Low today"]);
});

it("filters calendar weeks independently from deadline dates", () => {
  const candidates: Task[] = [
    base,
    { ...base, id: TaskId.make("t_AAAAAAC1"), scheduledDate: "2026-11-15" },
    { ...base, id: TaskId.make("t_AAAAAAC2"), scheduledDate: "2026-11-16" },
  ];
  expect(selectTaskCatalog(candidates, { ...filter, scheduled: "this_week" })).toEqual([
    candidates[1],
  ]);
  expect(selectTaskCatalog(candidates, { ...filter, scheduled: "next_week" })).toEqual([
    candidates[2],
  ]);
  expect(selectTaskCatalog(candidates, { ...filter, scheduled: "later" })).toEqual([base]);
});
