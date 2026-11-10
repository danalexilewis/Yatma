import {
  ProjectId,
  TaskId,
  emptyFolded,
  foldEvents,
  parseEventLine,
  selectThreadTasks,
  type FoldedEntities,
} from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { createLocalMutationWriter, localUserActor } from "../../application/mutations";
import { priorityRows, taskUpdateFromDrop, type PriorityRow } from "./taskReorder";

async function harness() {
  let folded: FoldedEntities = emptyFolded();
  let failCommit = false;
  const actor = localUserActor("reorder-test");
  const writer = createLocalMutationWriter({
    readSnapshot: async () => ({ folded, deviceId: "reorder-test", lastSeenAt: null }),
    commitBatch: async (events) => {
      if (failCommit) throw new Error("Disk full");
      folded = foldEvents([...folded.events, ...events]);
      return folded;
    },
    publish: (next) => {
      folded = next;
    },
    sessionGeneration: () => 0,
    now: () => "2026-10-16T00:00:00.000Z",
  });
  const home = ProjectId.make("p_AAAAAAA1");
  const work = ProjectId.make("p_AAAAAAA2");
  await writer.execute(
    [
      { type: "project.create", projectId: home, input: { title: "Home" } },
      { type: "project.create", projectId: work, input: { title: "Work" } },
      ...["One", "Two", "Three", "Four"].map((title, index) => ({
        type: "task.create" as const,
        taskId: TaskId.make(`t_AAAAAAA${index + 1}`),
        input: { title, projectId: index % 2 === 0 ? home : work },
      })),
    ],
    actor,
  );
  return {
    home,
    work,
    get folded() {
      return folded;
    },
    get rows() {
      return priorityRows(selectThreadTasks(folded), folded.projects, false);
    },
    get groupedRows() {
      return priorityRows(selectThreadTasks(folded), folded.projects, true);
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
    async drop(rows: PriorityRow[], from: number, to: number) {
      const data = [...rows];
      const [moved] = data.splice(from, 1);
      data.splice(to, 0, moved!);
      const input = taskUpdateFromDrop(data, from, to);
      if (input) await writer.execute([{ type: "task.update", input }], actor);
      return input;
    },
  };
}

function titles(folded: FoldedEntities) {
  return selectThreadTasks(folded).map((task) => task.title);
}

describe("task drag priority persistence", () => {
  it.each([
    [3, 0, ["Four", "One", "Two", "Three"]],
    [0, 3, ["Two", "Three", "Four", "One"]],
    [3, 1, ["One", "Four", "Two", "Three"]],
    [0, 2, ["Two", "Three", "One", "Four"]],
  ] as const)(
    "persists a drag from %i to %i through journal reload",
    async (from, to, expected) => {
      const app = await harness();
      const prior = new Map(selectThreadTasks(app.folded).map((task) => [task.id, task]));
      const input = await app.drop(app.rows, from, to);
      const reloaded = foldEvents(
        app.folded.events.map((event) => {
          const parsed = parseEventLine(JSON.stringify(event));
          if (!parsed.ok) throw new Error("Invalid saved event");
          return parsed.event;
        }),
      );
      expect(titles(reloaded)).toEqual(expected);
      for (const task of reloaded.tasks.values()) {
        expect(task.projectId).toBe(prior.get(task.id)?.projectId);
        if (task.id !== input?.taskId) expect(task.position).toBe(prior.get(task.id)?.position);
      }
    },
  );

  it("keeps no-op drops and headings out of the event journal", async () => {
    const app = await harness();
    const count = app.folded.events.length;
    expect(await app.drop(app.rows, 1, 1)).toBeNull();
    expect(taskUpdateFromDrop(app.groupedRows, 1, 0)).toBeNull();
    expect(taskUpdateFromDrop(app.rows, -1, 0)).toBeNull();
    expect(app.folded.events).toHaveLength(count);
  });

  it("reorders within a project while retaining global priority and project membership", async () => {
    const app = await harness();
    // Home heading, One, Three, Work heading, Two, Four, Unassigned heading.
    await app.drop(app.groupedRows, 2, 1);
    expect(titles(app.folded)).toEqual(["Three", "One", "Two", "Four"]);
    expect(app.folded.tasks.get(TaskId.make("t_AAAAAAA3"))?.projectId).toBe(app.home);
  });

  it("moves to the top of a later group even when global priorities interleave", async () => {
    const app = await harness();
    await app.drop(app.groupedRows, 5, 4);
    expect(titles(app.folded)).toEqual(["One", "Four", "Two", "Three"]);
  });

  it("changes project and priority together when dropped into a different group", async () => {
    const app = await harness();
    await app.drop(app.groupedRows, 2, 4);
    expect(titles(app.folded)).toEqual(["One", "Two", "Three", "Four"]);
    expect(app.folded.tasks.get(TaskId.make("t_AAAAAAA3"))?.projectId).toBe(app.work);
    expect(app.folded.events.at(-1)).toMatchObject({
      type: "task.updated",
      set: { projectId: app.work },
    });
  });

  it("allows dropping into the empty Unassigned section", async () => {
    const app = await harness();
    await app.drop(app.groupedRows, 1, 6);
    expect(app.folded.tasks.get(TaskId.make("t_AAAAAAA1"))?.projectId).toBeNull();
    expect(titles(app.folded).at(-1)).toBe("One");
  });

  it("leaves the committed order unchanged when saving a drag fails", async () => {
    const app = await harness();
    const before = app.folded;
    app.failCommit = true;
    await expect(app.drop(app.rows, 3, 0)).rejects.toThrow("Local changes could not be saved");
    expect(app.folded).toBe(before);
    app.failCommit = false;
    await app.drop(app.rows, 3, 0);
    expect(titles(app.folded)[0]).toBe("Four");
  });
});
