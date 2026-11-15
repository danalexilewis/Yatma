import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { planBatch, stampBatch, type BatchCommand } from "./batch.ts";
import { emptyFolded, foldEvents, type FoldedEntities } from "./fold.ts";
import { BatchId, DeviceId, EventId, TaskId } from "./ids.ts";
import { needsReview, reviewItemId, ReviewReceiveInput } from "./review.ts";
import { stackDayId } from "./dailyStack.ts";
import { latestWritesFromEvents, planUndo } from "./undo.ts";

const actor = { kind: "user" as const, deviceId: DeviceId.make("review-device") };
const now = "2026-11-11T00:00:00.000Z";
const taskId = TaskId.make("t_AAAAAAA1");
let seq = 1;
const id = reviewItemId("capture", taskId);
const receive: BatchCommand = {
  type: "review.receive",
  input: {
    id,
    taskId,
    source: "capture",
    sourceId: taskId,
    sourceRevision: "0",
    title: "Design",
    sourceUrl: null,
    receivedAt: now,
  },
};
function apply(
  state: FoldedEntities,
  commands: readonly BatchCommand[],
  at = now,
  undoes?: string,
): FoldedEntities {
  const planned = planBatch(state, commands, {
    actor,
    now: at,
    ...(undoes ? { undoes: BatchId.make(undoes) } : {}),
  });
  if (Result.isFailure(planned)) throw new Error(JSON.stringify(planned.failure));
  const stamped = stampBatch(planned.success.drafts, {
    now: at,
    observedMaxAt: state.events.at(-1)?.at ?? null,
    eventIds: planned.success.drafts.map(() => EventId.make(String(seq++).padStart(26, "0"))),
  });
  if (Result.isFailure(stamped)) throw new Error(JSON.stringify(stamped.failure));
  return foldEvents([...state.events, ...stamped.success]);
}
function initial() {
  return apply(emptyFolded(), [
    { type: "task.create", taskId, input: { title: "Design" } },
    receive,
  ]);
}
function decide(
  disposition: "pending" | "today" | "later" | "waiting" | "dismissed",
  reason = "Choice",
  revisitOn: string | null = null,
): BatchCommand {
  return { type: "review.decide", input: { id, disposition, reason, revisitOn } };
}

describe("durable review decisions", () => {
  it("receives exactly one item on retries without selecting or completing work", () => {
    const state = initial();
    const retry = apply(state, [receive]);
    expect(retry.events).toEqual(state.events);
    expect(retry.reviewItems.size).toBe(1);
    expect(retry.reviewItems.get(id)?.disposition).toBe("pending");
    expect(retry.dayEntries.size).toBe(0);
    const decided = apply(retry, [decide("today")]);
    expect(decided.dayEntries.size).toBe(0);
    expect(decided.tasks.get(taskId)?.status).toBe("todo");
  });
  it("rejects foreign task links and stale decisions before any draft escapes", () => {
    const state = initial();
    const result = planBatch(
      state,
      [decide("later"), { type: "review.link", id, taskId: TaskId.make("t_BBBBBBB2") }],
      { actor, now },
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(state.reviewItems.get(id)?.disposition).toBe("pending");
    const stale = planBatch(
      state,
      [
        {
          type: "review.decide",
          input: {
            id,
            disposition: "later",
            reason: "Wait",
            revisitOn: null,
            expectedUpdatedAt: "2026-11-01T00:00:00.000Z",
          },
        },
      ],
      { actor, now },
    );
    expect(Result.isFailure(stale) && stale.failure.code).toBe("entity_conflict");
  });
  it("rejects a linked task edited after the review snapshot before creating a day", () => {
    const observed = initial();
    const changed = apply(
      observed,
      [{ type: "task.update", input: { taskId, estimateMinutes: 120 } }],
      "2026-11-11T00:01:00.000Z",
    );
    expect(changed.reviewItems.get(id)?.updatedAt).toBe(observed.reviewItems.get(id)?.updatedAt);
    const date = "2026-11-11";
    const timezone = "Pacific/Auckland";
    const selected: BatchCommand = {
      type: "review.decide",
      input: {
        id,
        disposition: "today",
        reason: "Choose this work",
        revisitOn: null,
        expectedUpdatedAt: observed.reviewItems.get(id)!.updatedAt,
        expectedTaskUpdatedAt: observed.tasks.get(taskId)!.updatedAt,
      },
    };
    const commands: BatchCommand[] = [
      { type: "day.ensure", date, timezone },
      { type: "day.add", dayId: stackDayId(date, timezone), kind: "task", taskId },
      selected,
    ];
    const result = planBatch(changed, commands, { actor, now: "2026-11-11T00:02:00.000Z" });
    expect(Result.isFailure(result) && result.failure.code).toBe("entity_conflict");
    expect(changed.days.size).toBe(0);
    expect(changed.dayEntries.size).toBe(0);
    expect(changed.reviewItems.get(id)?.disposition).toBe("pending");
    const fresh = planBatch(
      changed,
      [
        {
          ...selected,
          input: { ...selected.input, expectedTaskUpdatedAt: changed.tasks.get(taskId)!.updatedAt },
        },
      ],
      { actor, now: "2026-11-11T00:02:00.000Z" },
    );
    expect(Result.isSuccess(fresh)).toBe(true);
  });
  it("separates seen state and dated resurfacing from decisions", () => {
    const state = apply(initial(), [
      { type: "review.seen", id },
      decide("later", "Thursday", "2026-11-12"),
    ]);
    const item = state.reviewItems.get(id)!;
    expect(item.seenAt).not.toBeNull();
    expect(needsReview(item, "2026-11-11")).toBe(false);
    expect(needsReview(item, "2026-11-12")).toBe(true);
    expect(apply(state, [{ type: "review.seen", id }]).events).toEqual(state.events);
  });
  it("preserves decisions/linkage across source updates and ignores reordered stale revisions", () => {
    const sourceId = "mailbox@example.com:abc";
    const gmailId = reviewItemId("gmail", sourceId);
    const input = {
      id: gmailId,
      taskId: null,
      source: "gmail" as const,
      sourceId,
      sourceRevision: "9007199254740993",
      title: "A request",
      sourceText: "Untrusted snippet",
      sourceUrl: "https://mail.google.com/mail/u/0/#inbox/abc",
      receivedAt: now,
    };
    let state = apply(initial(), [
      { type: "review.receive", input },
      { type: "review.link", id: gmailId, taskId },
      {
        type: "review.decide",
        input: {
          id: gmailId,
          disposition: "waiting",
          reason: "Waiting on colleague",
          revisitOn: null,
        },
      },
    ]);
    state = apply(state, [
      {
        type: "review.receive",
        input: { ...input, sourceRevision: "9007199254740994", title: "Updated request" },
      },
    ]);
    const updated = state.reviewItems.get(gmailId)!;
    expect(updated.taskId).toBe(taskId);
    expect(updated.disposition).toBe("waiting");
    expect(updated.title).toBe("Updated request");
    expect(apply(state, [{ type: "review.receive", input }]).events).toEqual(state.events);
    expect(foldEvents([...state.events].reverse()).reviewItems).toEqual(state.reviewItems);
    const conflicting = planBatch(
      state,
      [
        {
          type: "review.receive",
          input: { ...input, sourceRevision: "9007199254740994", title: "Different payload" },
        },
      ],
      { actor, now },
    );
    expect(Result.isFailure(conflicting) && conflicting.failure.code).toBe("entity_conflict");
  });
  it("undo restores earliest decisions while preserving a later field edit", () => {
    const start = initial();
    const changed = apply(start, [
      decide("later", "Pause", "2026-11-12"),
      decide("waiting", "Await response", "2026-11-13"),
    ]);
    const batch = changed.events.slice(start.events.length);
    const later = apply(changed, [{ type: "review.seen", id }]);
    const undo = planUndo(batch, later, latestWritesFromEvents(later.events));
    const commands: BatchCommand[] = undo.reverts.flatMap((revert) =>
      revert.type === "review.updated"
        ? [{ type: "review.restore" as const, id: revert.itemId, set: revert.set }]
        : [],
    );
    const restored = apply(later, commands, now, "original");
    expect(restored.reviewItems.get(id)?.disposition).toBe("pending");
    expect(restored.reviewItems.get(id)?.reason).toBeNull();
    expect(restored.reviewItems.get(id)?.seenAt).not.toBeNull();
    const laterDecision = apply(changed, [decide("later", "New choice", null)]);
    const skipped = planUndo(batch, laterDecision, latestWritesFromEvents(laterDecision.events));
    expect(skipped.skipped.some((skip) => skip.field === "disposition")).toBe(true);
  });
  it("requires Undo context and bounded valid provider metadata", () => {
    const result = planBatch(
      initial(),
      [{ type: "review.restore", id, set: { disposition: "pending" } }],
      { actor, now },
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(ReviewReceiveInput)({ ...receive.input, sourceRevision: "-1" }),
      ),
    ).toBe(true);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(ReviewReceiveInput)({
          ...receive.input,
          sourceUrl: "javascript:alert(1)",
        }),
      ),
    ).toBe(true);
  });
});
