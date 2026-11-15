import { DeviceId, TaskId, foldEvents, EventId, type Task } from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { createTaskInteractions } from "./taskInteractions";

const taskId = TaskId.make("t_AAAAAAA1");
function fixture(): Task {
  return foldEvents([
    {
      v: 1,
      id: EventId.make("00000000000000000000000001"),
      at: "2026-11-10T00:00:00Z",
      by: { kind: "user", deviceId: DeviceId.make("test") },
      type: "task.created",
      taskId,
      title: "Original",
      projectId: null,
      status: "todo",
      quadrant: null,
      position: "n",
    },
  ]).tasks.get(taskId)!;
}

describe("account task interactions", () => {
  it("shares one pending write across five observers and reads committed state for each desired action", async () => {
    let task = fixture();
    let commit!: () => void;
    let writes = 0;
    const coordinator = createTaskInteractions({
      readTask: () => task,
      getGeneration: () => 1,
      updateTask: async (input) => {
        writes++;
        await new Promise<void>((resolve) => {
          commit = resolve;
        });
        task = { ...task, status: input.status! };
        return "updated";
      },
    });
    const notifications = [0, 0, 0, 0, 0];
    const unsubscribe = notifications.map((_, index) =>
      coordinator.subscribe(() => {
        notifications[index]!++;
      }),
    );
    const pending = coordinator.setStatus(taskId, "done");
    expect(coordinator.getSnapshot(taskId).pending).toBe(true);
    expect(task.status).toBe("todo");
    expect(await coordinator.setStatus(taskId, "done")).toBe("busy");
    unsubscribe[0]!();
    commit();
    expect(await pending).toBe("updated");
    expect(task.status).toBe("done");
    expect(writes).toBe(1);
    expect(notifications).toEqual([1, 2, 2, 2, 2]);
    expect(await coordinator.setStatus(taskId, "done")).toBe("noop");
    const reopen = coordinator.setStatus(taskId, "todo");
    commit();
    await reopen;
    expect(task.status).toBe("todo");
  });

  it("retains committed status and shares retryable failure; missing/deleted refs cannot mutate", async () => {
    let task: Task | undefined = fixture();
    const coordinator = createTaskInteractions({
      readTask: () => task,
      getGeneration: () => 1,
      updateTask: async () => {
        throw Object.assign(new Error("Save failed"), { code: "storage_failed" });
      },
    });
    await expect(coordinator.setStatus(taskId, "done")).rejects.toThrow("Save failed");
    expect(task.status).toBe("todo");
    expect(coordinator.getSnapshot(taskId)).toEqual({
      pending: false,
      error: "Save failed",
      code: "storage_failed",
    });
    task = { ...task, deletedAt: "2026-11-10T01:00:00Z" };
    expect(await coordinator.setStatus(taskId, "done")).toBe("unavailable");
    task = undefined;
    expect(await coordinator.setStatus(taskId, "done")).toBe("unavailable");
  });

  it("discards old account pending completion and errors after a generation change", async () => {
    let generation = 1;
    let reject!: (error: Error) => void;
    const coordinator = createTaskInteractions({
      readTask: fixture,
      getGeneration: () => generation,
      updateTask: async () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    });
    const pending = coordinator.setStatus(taskId, "done");
    generation++;
    coordinator.reset();
    const idle = coordinator.getSnapshot(taskId);
    reject(new Error("Old account error"));
    await expect(pending).rejects.toThrow("Old account error");
    expect(coordinator.getSnapshot(taskId)).toBe(idle);
    expect(idle).toEqual({ pending: false, error: null });
  });
});
