import {
  DeviceId,
  BatchId as BatchIdSchema,
  generateEventId,
  type Actor,
  type BatchCommand,
  type BatchId,
  type Event,
  type FoldedEntities,
  planBatch,
  planUndo,
  stampBatch,
  latestWritesFromEvents,
  type UndoSkip,
  type UndoRevert,
  planProjectConsolidation,
  legacyHeadingProjectId,
} from "@yatma/core";
import * as Result from "effect/Result";

import type { HydratedLocalState } from "../db/database";
import { lastSeenAtFromEvents } from "../db/entities";

export type LocalMutationResult = {
  readonly events: readonly Event[];
  readonly noops: readonly { readonly commandIndex: number; readonly reason: "unchanged" }[];
  readonly folded: FoldedEntities;
};

export type LocalUndoResult = LocalMutationResult & { readonly skipped: readonly UndoSkip[] };

export type LocalMutationFailure = Error & {
  readonly code: "session_changed" | "planning_failed" | "stamping_failed" | "storage_failed";
  readonly detail?: unknown;
};

export type LocalMutationWriterDeps = {
  readonly readSnapshot: () => Promise<HydratedLocalState>;
  readonly commitBatch: (events: readonly Event[]) => Promise<FoldedEntities>;
  readonly publish: (folded: FoldedEntities, events: readonly Event[]) => void;
  readonly sessionGeneration: () => number;
  readonly onStorageFailure?: (error: unknown) => void;
  readonly now?: () => string;
};

/** Serializes current snapshot acquisition through durable commit and publication. */
export function createLocalMutationWriter(deps: LocalMutationWriterDeps) {
  let tail: Promise<void> = Promise.resolve();

  async function serialize<A>(operation: () => Promise<A>): Promise<A> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function execute(
    commands: readonly BatchCommand[],
    actor: Actor,
    context?: { readonly batchId?: BatchId; readonly undoes?: BatchId },
  ): Promise<LocalMutationResult> {
    const generation = deps.sessionGeneration();
    return serialize(async () => {
      const snapshot = await readCurrentSnapshot(deps, generation);
      return executeFromSnapshot(deps, generation, snapshot, commands, actor, context);
    });
  }

  async function executeUndo(
    originalBatchId: BatchId,
    batchEvents: readonly Event[],
    actor: Actor,
    reason: string,
  ): Promise<LocalUndoResult> {
    const generation = deps.sessionGeneration();
    return serialize(async () => {
      const snapshot = await readCurrentSnapshot(deps, generation);
      const undo = planUndo(
        batchEvents,
        {
          projects: snapshot.folded.projects,
          tasks: snapshot.folded.tasks,
          pages: snapshot.folded.pages,
          chats: snapshot.folded.chats,
        },
        latestWritesFromEvents(snapshot.folded.events),
      );
      const commands = undo.reverts.map((revert) =>
        withUndoReason(commandFromRevert(revert), reason),
      );
      const result = await executeFromSnapshot(deps, generation, snapshot, commands, actor, {
        batchId: BatchIdSchema.make(`undo:${originalBatchId}:${generateEventId()}`),
        undoes: originalBatchId,
      });
      return { ...result, skipped: undo.skipped };
    });
  }

  async function consolidateProjects(actor: Actor): Promise<LocalMutationResult> {
    const generation = deps.sessionGeneration();
    return serialize(async () => {
      const snapshot = await readCurrentSnapshot(deps, generation);
      const commands = planProjectConsolidation(snapshot.folded, legacyHeadingProjectId);
      return executeFromSnapshot(deps, generation, snapshot, commands, actor, {
        batchId: BatchIdSchema.make(`project-migration:${generateEventId()}`),
      });
    });
  }

  return { execute, executeUndo, serialize, consolidateProjects };
}

function withUndoReason(command: BatchCommand, reason: string): BatchCommand {
  if (command.type === "chat.message") return command;
  return { ...command, input: { ...command.input, reason: reason.trim() } } as BatchCommand;
}

async function readCurrentSnapshot(
  deps: LocalMutationWriterDeps,
  generation: number,
): Promise<HydratedLocalState> {
  assertGeneration(deps, generation);
  let snapshot: HydratedLocalState;
  try {
    snapshot = await deps.readSnapshot();
  } catch (error) {
    deps.onStorageFailure?.(error);
    throw mutationFailure("storage_failed", "Local storage could not be read", error);
  }
  assertGeneration(deps, generation);
  return snapshot;
}

async function executeFromSnapshot(
  deps: LocalMutationWriterDeps,
  generation: number,
  snapshot: HydratedLocalState,
  commands: readonly BatchCommand[],
  actor: Actor,
  context?: { readonly batchId?: BatchId; readonly undoes?: BatchId },
): Promise<LocalMutationResult> {
  const planned = planBatch(snapshot.folded, commands, { actor, ...context });
  if (Result.isFailure(planned)) {
    throw mutationFailure("planning_failed", planned.failure.message, planned.failure);
  }
  if (planned.success.drafts.length === 0) {
    return { events: [], noops: planned.success.noops, folded: snapshot.folded };
  }
  const stamped = stampBatch(planned.success.drafts, {
    observedMaxAt: lastSeenAtFromEvents(snapshot.folded.events),
    now: (deps.now ?? (() => new Date().toISOString()))(),
    eventIds: planned.success.drafts.map(() => generateEventId()),
  });
  if (Result.isFailure(stamped)) {
    throw mutationFailure("stamping_failed", stamped.failure.message, stamped.failure);
  }
  assertGeneration(deps, generation);
  let folded: FoldedEntities;
  try {
    folded = await deps.commitBatch(stamped.success);
  } catch (error) {
    deps.onStorageFailure?.(error);
    throw mutationFailure("storage_failed", "Local changes could not be saved", error);
  }
  assertGeneration(deps, generation);
  deps.publish(folded, stamped.success);
  return { events: stamped.success, noops: planned.success.noops, folded };
}

function commandFromRevert(revert: UndoRevert): BatchCommand {
  switch (revert.type) {
    case "task.updated":
      return { type: "task.update", input: { taskId: revert.taskId, ...revert.set } };
    case "project.updated":
      return { type: "project.update", input: { projectId: revert.projectId, ...revert.set } };
    case "page.updated":
      return { type: "page.update", input: { pageId: revert.pageId, ...revert.set } };
    case "chat.updated":
      return { type: "chat.update", input: { chatId: revert.chatId, ...revert.set } };
  }
}

function assertGeneration(deps: LocalMutationWriterDeps, generation: number): void {
  if (deps.sessionGeneration() !== generation) {
    throw mutationFailure("session_changed", "Local session changed during mutation");
  }
}

function mutationFailure(
  code: LocalMutationFailure["code"],
  message: string,
  detail?: unknown,
): LocalMutationFailure {
  return Object.assign(new Error(message), {
    code,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** Use the current authenticated user as the actor for manual commands. */
export function localUserActor(deviceId: string): Actor {
  return { kind: "user", deviceId: DeviceId.make(deviceId) };
}
