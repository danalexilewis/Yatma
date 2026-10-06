// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { DeviceId, ProjectId, TaskId } from "./ids.ts";
import type { Task } from "./schemas.ts";
import {
  AgentReasonRequired,
  planCreate,
  planUpdate,
  resolveExplicitPlacement,
  resolveStartPosition,
  resolveTriagePosition,
  sortTasksByPosition,
} from "./rules.ts";

const projectId = ProjectId.make("p_01234567");
const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };

function task(id: string, position: string, overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.make(id),
    projectId,
    title: id,
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

describe("resolveExplicitPlacement", () => {
  it("places at top and bottom", () => {
    const tasks = [task("t_AAAAAAA1", "m"), task("t_AAAAAAA2", "t")];
    const top = resolveExplicitPlacement(tasks, { kind: "top" });
    const bottom = resolveExplicitPlacement(tasks, { kind: "bottom" });
    expect(top < "m").toBe(true);
    expect(bottom > "t").toBe(true);
  });

  it("places before and after a neighbor", () => {
    const tasks = [task("t_AAAAAAA1", "f"), task("t_AAAAAAA2", "t")];
    const beforeB = resolveExplicitPlacement(tasks, {
      kind: "before",
      taskId: TaskId.make("t_AAAAAAA2"),
    });
    const afterA = resolveExplicitPlacement(tasks, {
      kind: "after",
      taskId: TaskId.make("t_AAAAAAA1"),
    });
    expect(beforeB > "f" && beforeB < "t").toBe(true);
    expect(afterA > "f" && afterA < "t").toBe(true);
  });
});

describe("resolveTriagePosition", () => {
  it("puts a triaged todo after the last todo in that quadrant", () => {
    const tasks = [
      task("t_AAAAAAA1", "d", { quadrant: "do" }),
      task("t_AAAAAAA2", "m", { quadrant: "schedule" }),
      task("t_AAAAAAA3", "t"),
    ];
    const position = resolveTriagePosition(tasks, TaskId.make("t_AAAAAAA3"), "do");
    expect(position).not.toBeNull();
    expect(position! > "d" && position! < "m").toBe(true);
  });

  it("puts inbox returns at the bottom", () => {
    const tasks = [
      task("t_AAAAAAA1", "d", { quadrant: "do" }),
      task("t_AAAAAAA2", "m", { quadrant: "schedule" }),
    ];
    const position = resolveTriagePosition(tasks, TaskId.make("t_AAAAAAA2"), null);
    expect(position).not.toBeNull();
    expect(position! > "m").toBe(true);
  });

  it("keeps doing tasks when only the quadrant changes", () => {
    const tasks = [task("t_AAAAAAA1", "m", { status: "in_progress", quadrant: null })];
    expect(resolveTriagePosition(tasks, TaskId.make("t_AAAAAAA1"), "do")).toBeNull();
  });
});

describe("planUpdate", () => {
  it("moves a started task to the top", () => {
    const tasks = [task("t_AAAAAAA1", "m"), task("t_AAAAAAA2", "t")];
    const planned = planUpdate(
      tasks,
      { taskId: TaskId.make("t_AAAAAAA2"), status: "in_progress" },
      user,
    );
    expect(Result.isSuccess(planned)).toBe(true);
    if (!Result.isSuccess(planned)) return;
    expect(planned.success.kind).toBe("update");
    if (planned.success.kind !== "update") return;
    expect(planned.success.set.status).toBe("in_progress");
    expect(planned.success.set.position).toBeDefined();
    expect(planned.success.set.position! < "m").toBe(true);
  });

  it("honors explicit placement over start-to-top", () => {
    const tasks = [task("t_AAAAAAA1", "d"), task("t_AAAAAAA2", "m"), task("t_AAAAAAA3", "t")];
    const planned = planUpdate(
      tasks,
      {
        taskId: TaskId.make("t_AAAAAAA3"),
        status: "in_progress",
        placement: { kind: "after", taskId: TaskId.make("t_AAAAAAA1") },
      },
      user,
    );
    expect(Result.isSuccess(planned)).toBe(true);
    if (!Result.isSuccess(planned) || planned.success.kind !== "update") return;
    expect(planned.success.set.position! > "d" && planned.success.set.position! < "m").toBe(true);
  });

  it("writes nothing for a no-op", () => {
    const tasks = [task("t_AAAAAAA1", "m", { title: "Same" })];
    const planned = planUpdate(
      tasks,
      { taskId: TaskId.make("t_AAAAAAA1"), title: "Same" },
      user,
    );
    expect(planned).toEqual(Result.succeed({ kind: "noop" }));
  });

  it("requires a reason from agents", () => {
    const tasks = [task("t_AAAAAAA1", "m")];
    const planned = planUpdate(
      tasks,
      { taskId: TaskId.make("t_AAAAAAA1"), status: "done" },
      {
        kind: "agent",
        chatId: "c_AAAAAAA1" as never,
        model: "test-model",
      },
    );
    expect(Result.isFailure(planned)).toBe(true);
    if (!Result.isFailure(planned)) return;
    expect(planned.failure).toBeInstanceOf(AgentReasonRequired);
  });
});

describe("planCreate", () => {
  it("creates inbox todos at the bottom", () => {
    const tasks = [task("t_AAAAAAA1", "m")];
    const planned = planCreate(tasks, { title: "New" }, user);
    expect(Result.isSuccess(planned)).toBe(true);
    if (!Result.isSuccess(planned)) return;
    expect(planned.success.quadrant).toBeNull();
    expect(planned.success.status).toBe("todo");
    expect(planned.success.position > "m").toBe(true);
  });
});

describe("sortTasksByPosition", () => {
  it("orders by position then id", () => {
    const ordered = sortTasksByPosition([
      task("t_AAAAAAA2", "m"),
      task("t_AAAAAAA1", "d"),
      task("t_AAAAAAA3", "m"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "t_AAAAAAA1",
      "t_AAAAAAA2",
      "t_AAAAAAA3",
    ]);
  });
});

describe("resolveStartPosition", () => {
  it("matches top placement", () => {
    const tasks = [task("t_AAAAAAA1", "m")];
    expect(resolveStartPosition(tasks, TaskId.make("t_AAAAAAA9"))).toBe(
      resolveExplicitPlacement(tasks, { kind: "top" }, TaskId.make("t_AAAAAAA9")),
    );
  });
});
