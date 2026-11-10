import {
  BatchId,
  type BatchCommand,
  type BatchSnapshot,
  type EventId,
  InternalError,
  type PlanFailure,
  type PlanBatchContext,
  type StampFailure,
  foldEvents,
  generateEventId,
  planBatch,
  stampBatch,
  type SyncBatch,
} from "@yatma/core";
import type { Actor } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import * as Stream from "effect/Stream";

import * as EventStore from "../eventStore.ts";

export interface CommittedBatch {
  readonly batchId: BatchId | null;
  readonly events: readonly EventStore.StoredEvent[];
}

export interface MutationResult {
  readonly batchId: BatchId;
  readonly events: readonly EventStore.StoredEvent[];
  readonly noops: readonly { readonly commandIndex: number; readonly reason: "unchanged" }[];
  readonly snapshot: BatchSnapshot;
}

export type MutationFailure =
  | { readonly _tag: "planning_failed"; readonly failure: PlanFailure }
  | { readonly _tag: "stamping_failed"; readonly failure: StampFailure }
  | { readonly _tag: "journal_rejected"; readonly reject: EventStore.PushReject };

/** A user-space local commit hub; callers scope each live subscription. */
export interface CommitHub {
  readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly publish: (batch: CommittedBatch) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<Stream.Stream<CommittedBatch>, never, Scope.Scope>;
  readonly observe: Stream.Stream<CommittedBatch, never, Scope.Scope>;
  readonly observeAfter: (
    after: number,
  ) => Stream.Stream<SyncBatch, SqlError.SqlError, Scope.Scope | SqlClient.SqlClient>;
}

/**
 * Create an in-memory post-commit observer for one durable user-space.
 * Register observers before catch-up reads and dedupe by sequence at the host.
 */
export const makeCommitHub = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<CommittedBatch>();
  const semaphore = yield* Semaphore.make(1);
  const subscribe = Effect.map(PubSub.subscribe(pubsub), (subscription) =>
    Stream.fromEffectRepeat(PubSub.take(subscription)),
  );
  const observe = Stream.unwrap(subscribe);
  const observeAfter = (after: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading the durable cursor so commits during catch-up
        // remain queued and can be sequence-deduplicated below.
        const subscription = yield* PubSub.subscribe(pubsub);
        const catchup = yield* EventStore.eventsAfter(after);
        const live = Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
          Stream.mapAccum(
            () => catchup.after,
            (cursor, batch) => {
              const events = batch.events
                .filter((event) => event.seq > cursor)
                .sort((left, right) => left.seq - right.seq);
              const next = events.at(-1)?.seq ?? cursor;
              return [next, events.length > 0 ? [{ events, after: next }] : []] as const;
            },
          ),
        );
        return Stream.concat(Stream.make(catchup), live);
      }),
    );
  return {
    exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => semaphore.withPermits(1)(effect),
    publish: (batch: CommittedBatch) => PubSub.publish(pubsub, batch).pipe(Effect.asVoid),
    subscribe,
    observe,
    observeAfter,
  } satisfies CommitHub;
});

export interface ExecuteBatchInput {
  readonly commands: readonly BatchCommand[];
  readonly actor: Actor;
  readonly batchId?: BatchId;
  readonly undoes?: BatchId;
  readonly now?: string;
}

export interface MutationService {
  readonly executeBatch: (
    input: ExecuteBatchInput,
  ) => Effect.Effect<MutationResult, MutationFailure | SqlError.SqlError | InternalError, SqlClient.SqlClient>;
  readonly observeCommits: CommitHub["observe"];
  readonly observeAfter: CommitHub["observeAfter"];
  readonly pushIncomingBatch: (
    events: readonly unknown[],
    now: string,
  ) => Effect.Effect<EventStore.PushResult, SqlError.SqlError | InternalError, SqlClient.SqlClient>;
}

/**
 * Serialize snapshot, planning, stamping, and journal commit on the same SQL
 * transaction. Notifications happen only after that transaction commits.
 */
export function makeMutationService(
  hub: CommitHub,
  ensureWritable: () => Effect.Effect<void, InternalError> = () => Effect.void,
): MutationService {
  const pushIncomingBatch = Effect.fn("WorkerMutations.pushIncomingBatch")(function* (
    events: readonly unknown[],
    now: string,
  ) {
    return yield* hub.exclusive(
      Effect.gen(function* () {
        yield* ensureWritable();
        const pushed = yield* EventStore.pushEvents(events, now);
        if (pushed.ok && pushed.result.accepted.length > 0) {
          const accepted = new Set(pushed.result.accepted);
          const stored = (yield* EventStore.loadAllEvents)
            .filter((event) => accepted.has(event.id))
            .sort((left, right) => left.seq - right.seq);
          yield* hub.publish({ batchId: null, events: stored });
        }
        return pushed;
      }),
    );
  });

  const executeBatch = Effect.fn("WorkerMutations.executeBatch")(function* (
    input: ExecuteBatchInput,
  ) {
    const sql = yield* SqlClient.SqlClient;
    const requestedBatchId = input.batchId ?? BatchId.make(`batch_${generateEventId()}`);
    const now = input.now ?? new Date().toISOString();

    return yield* hub.exclusive(
      Effect.gen(function* () {
        yield* ensureWritable();
        const committed = yield* sql.withTransaction(
          Effect.gen(function* () {
            const previousEvents = yield* EventStore.loadAllEvents;
            const snapshot = foldEvents(previousEvents);
            let observedMaxAt: string | null = null;
            let observedMaxMs = Number.NEGATIVE_INFINITY;
            for (const event of previousEvents) {
              const eventMs = Date.parse(event.at);
              if (Number.isFinite(eventMs) && eventMs > observedMaxMs) {
                observedMaxMs = eventMs;
                observedMaxAt = event.at;
              }
            }
            const context: PlanBatchContext = {
              actor: input.actor,
              batchId: requestedBatchId,
              ...(input.undoes ? { undoes: input.undoes } : {}),
            };
            const planned = planBatch(snapshot, input.commands, context);
            if (Result.isFailure(planned)) {
              return {
                ok: false as const,
                failure: { _tag: "planning_failed" as const, failure: planned.failure },
              };
            }

            const eventIds: EventId[] = planned.success.drafts.map(() => generateEventId());
            const stamped = stampBatch(planned.success.drafts, { observedMaxAt, now, eventIds });
            if (Result.isFailure(stamped)) {
              return {
                ok: false as const,
                failure: { _tag: "stamping_failed" as const, failure: stamped.failure },
              };
            }

            const append = yield* EventStore.appendPlannedBatch(stamped.success);
            if (!append.ok) {
              return {
                ok: false as const,
                failure: { _tag: "journal_rejected" as const, reject: append.reject },
              };
            }
            const sequences = new Map(
              append.result.assigned.map((assignment) => [assignment.id, assignment.seq]),
            );
            const storedEvents = stamped.success.map((event) => {
              const seq = sequences.get(event.id);
              if (seq === undefined)
                throw new Error(`Missing committed sequence for event ${event.id}`);
              return { ...event, seq };
            });
            const postCommitEvents = yield* EventStore.loadAllEvents;
            return {
              ok: true as const,
              result: {
                batchId: requestedBatchId,
                events: storedEvents,
                noops: planned.success.noops,
                snapshot: foldEvents(postCommitEvents),
              } satisfies MutationResult,
              accepted: new Set(append.result.accepted),
            };
          }),
        );

        if (!committed.ok) return yield* Effect.fail(committed.failure);
        const newEvents = committed.result.events.filter((event) =>
          committed.accepted.has(event.id),
        );
        if (newEvents.length > 0) {
          yield* hub.publish({ batchId: committed.result.batchId, events: newEvents });
        }
        return committed.result;
      }),
    );
  });

  return {
    executeBatch,
    observeCommits: hub.observe,
    observeAfter: hub.observeAfter,
    pushIncomingBatch,
  };
}
