import {
  BatchId,
  DeviceId,
  TaskId,
  legacyHeadingProjectId,
  emptyFolded,
  foldEvents,
  type Event,
  type FoldedEntities,
} from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import {
  createLocalMutationWriter,
  localUserActor,
  type LocalMutationWriterDeps,
} from "./mutations";

function makeHarness() {
  let folded: FoldedEntities = emptyFolded();
  let published = 0;
  let failCommit = false;
  const deps: LocalMutationWriterDeps = {
    readSnapshot: async () => ({ folded, deviceId: "device-writer", lastSeenAt: null }),
    commitBatch: async (events) => {
      if (failCommit) throw new Error("injected storage failure");
      folded = foldEvents([...folded.events, ...events]);
      return folded;
    },
    publish: (next) => {
      published += 1;
      folded = next;
    },
    sessionGeneration: () => 0,
    now: () => "2026-10-15T00:00:00.000Z",
  };
  return {
    writer: createLocalMutationWriter(deps),
    get folded() {
      return folded;
    },
    get published() {
      return published;
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
  };
}

const actor = localUserActor("device-writer");
function createTask(id: string, title: string) {
  return {
    type: "task.create" as const,
    taskId: TaskId.make(id),
    input: { title, projectId: null },
  };
}

function updateTask(taskId: string, title: string) {
  return { type: "task.update" as const, input: { taskId: TaskId.make(taskId), title } };
}

describe("local mutation writer", () => {
  it("converts legacy grouping in one durable commit, retries failures, and reads concurrent assignments", async () => {
    const harness = makeHarness();
    const taskId = TaskId.make("t_AAAAAAA6");
    await harness.writer.execute(
      [{ type: "task.create", taskId, input: { title: "Legacy task", tags: ["Home"] } }],
      actor,
    );
    harness.failCommit = true;
    await expect(harness.writer.consolidateProjects(actor)).rejects.toThrow(
      "Local changes could not be saved",
    );
    expect(harness.folded.projects.size).toBe(0);
    expect(harness.folded.tasks.get(taskId)?.tags).toEqual(["Home"]);
    const published = harness.published;
    harness.failCommit = false;
    // Queue the assignment first; migration must acquire its snapshot after this write.
    await Promise.all([
      harness.writer.execute(
        [
          {
            type: "project.create",
            projectId: legacyHeadingProjectId("Work"),
            input: { title: "Work" },
          },
          { type: "task.update", input: { taskId, projectId: legacyHeadingProjectId("Work") } },
        ],
        actor,
      ),
      harness.writer.consolidateProjects(actor),
    ]);
    expect(harness.published).toBe(published + 2);
    expect(harness.folded.tasks.get(taskId)).toMatchObject({
      projectId: legacyHeadingProjectId("Work"),
      tags: [],
    });
    expect(harness.folded.projects.size).toBe(2);
    await harness.writer.consolidateProjects(actor);
    expect(harness.published).toBe(published + 2);
  });

  it("serializes snapshot, planning, commit, and publication for overlapping edits", async () => {
    const harness = makeHarness();
    await Promise.all([
      harness.writer.execute([createTask("t_AAAAAAA1", "One")], actor),
      harness.writer.execute([createTask("t_AAAAAAA2", "Two")], actor),
    ]);
    expect(harness.folded.tasks.size).toBe(2);
    expect(harness.published).toBe(2);
  });

  it("does not publish when durable commit fails", async () => {
    const harness = makeHarness();
    harness.failCommit = true;
    await expect(harness.writer.execute([createTask("t_AAAAAAA3", "Fail")], actor)).rejects.toThrow(
      "Local changes could not be saved",
    );
    expect(harness.folded.tasks.size).toBe(0);
    expect(harness.published).toBe(0);
  });

  it("skips undo when a later edit returns the field to its prior value", async () => {
    const harness = makeHarness();
    const taskId = "t_AAAAAAA4";
    await harness.writer.execute([createTask(taskId, "Original")], actor);
    const batchId = BatchId.make("turn-batch");
    const turn = await harness.writer.execute([updateTask(taskId, "Turn value")], actor, {
      batchId,
    });
    await harness.writer.execute([updateTask(taskId, "Original")], actor);

    const undo = await harness.writer.executeUndo(
      batchId,
      turn.events as readonly Event[],
      {
        kind: "user",
        deviceId: DeviceId.make("device-writer"),
      },
      "Undo test batch",
    );
    expect(undo.events).toHaveLength(0);
    expect(undo.skipped).toContainEqual({
      entityId: taskId,
      field: "title",
      reason: "changed_since",
    });
    expect(harness.folded.tasks.get(TaskId.make(taskId))?.title).toBe("Original");
  });

  it("reverts a complete planned command batch in one commit", async () => {
    const harness = makeHarness();
    const taskId = "t_AAAAAAA5";
    await harness.writer.execute([createTask(taskId, "Before")], actor);
    const batchId = BatchId.make("multi-edit-batch");
    const edit = await harness.writer.execute(
      [
        {
          type: "task.update",
          input: { taskId: TaskId.make(taskId), title: "After", notes: "Added note" },
        },
      ],
      actor,
      { batchId },
    );
    const commitsBeforeUndo = harness.published;
    const undo = await harness.writer.executeUndo(batchId, edit.events, actor, "Undo test edit");
    expect(harness.published).toBe(commitsBeforeUndo + 1);
    expect(undo.events).toHaveLength(1);
    expect(undo.skipped).toHaveLength(0);
    expect(harness.folded.tasks.get(TaskId.make(taskId))?.title).toBe("Before");
    expect(harness.folded.tasks.get(TaskId.make(taskId))?.notes).toBe("");
  });
});
