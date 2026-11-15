import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import { makeCommitHub, makeMutationService } from "./mutations.ts";
import { migrate, nextReviewOccurrence, publishDueReview, saveSchedule } from "./reviewSchedule.ts";

describe("daily review invitations", () => {
  it("finds local occurrences across DST and never schedules disabled reviews", () => {
    const base = { enabled: true, localTime: "02:30", timezone: "America/New_York" };
    expect(
      new Date(nextReviewOccurrence(base, Date.parse("2026-03-08T05:00:00Z"))!).toISOString(),
    ).toBe("2026-03-08T07:00:00.000Z");
    expect(nextReviewOccurrence({ ...base, enabled: false }, Date.now())).toBeNull();
    expect(
      new Date(
        nextReviewOccurrence({ ...base, localTime: "01:30" }, Date.parse("2026-11-01T05:40:00Z"))!,
      ).toISOString(),
    ).toBe("2026-11-02T06:30:00.000Z");
  });
  it.effect("persists one invitation across retry and rejects callbacks after disable", () =>
    Effect.gen(function* () {
      yield* EventStore.migrate;
      yield* migrate;
      const hub = yield* makeCommitHub;
      const mutations = makeMutationService(hub);
      const saved = yield* saveSchedule({
        enabled: true,
        localTime: "09:00",
        timezone: "Pacific/Auckland",
      });
      const now = Date.parse("2026-11-11T00:00:00Z");
      expect((yield* publishDueReview(saved.version, now, mutations)).published).toBe(true);
      expect((yield* publishDueReview(saved.version, now, mutations)).published).toBe(false);
      const folded = yield* EventStore.loadFolded;
      expect([...folded.chats.values()].flatMap((c) => c.messages)).toHaveLength(1);
      expect(folded.dayEntries.size).toBe(0);
      yield* saveSchedule({ enabled: false, localTime: "09:00", timezone: "Pacific/Auckland" });
      expect((yield* publishDueReview(saved.version, now + 86400000, mutations)).published).toBe(
        false,
      );
    }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
  );
});

it.effect("an old callback cannot publish after schedule version changes", () =>
  Effect.gen(function* () {
    yield* EventStore.migrate;
    yield* migrate;
    const mutations = makeMutationService(yield* makeCommitHub);
    const old = yield* saveSchedule({ enabled: true, localTime: "09:00", timezone: "UTC" });
    const changed = yield* saveSchedule({ enabled: true, localTime: "15:00", timezone: "UTC" });
    const result = yield* publishDueReview(
      old.version,
      Date.parse("2026-11-11T10:00:00Z"),
      mutations,
    );
    expect(result.published).toBe(false);
    expect(result.version).toBe(changed.version);
    expect(result.nextAt).toBe(Date.parse("2026-11-11T15:00:00Z"));
    expect(
      [...(yield* EventStore.loadFolded).chats.values()].flatMap((chat) => chat.messages),
    ).toHaveLength(0);
    const disabled = yield* saveSchedule({ enabled: false, localTime: "15:00", timezone: "UTC" });
    const late = yield* publishDueReview(
      changed.version,
      Date.parse("2026-11-11T16:00:00Z"),
      mutations,
    );
    expect(late).toEqual({ published: false, nextAt: null, version: disabled.version });
  }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
);

it.effect("coalesces missed days into the current date and recovers publication after reload", () =>
  Effect.gen(function* () {
    yield* EventStore.migrate;
    yield* migrate;
    const saved = yield* saveSchedule({ enabled: true, localTime: "09:00", timezone: "UTC" });
    const mutations = makeMutationService(yield* makeCommitHub);
    yield* publishDueReview(saved.version, Date.parse("2026-11-11T10:00:00Z"), mutations);
    const restartedWriter = makeMutationService(yield* makeCommitHub);
    const catchup = yield* publishDueReview(
      saved.version,
      Date.parse("2026-11-15T11:00:00Z"),
      restartedWriter,
    );
    expect(catchup.published).toBe(true);
    expect(catchup.nextAt).toBe(Date.parse("2026-11-16T09:00:00Z"));
    const messages = [...(yield* EventStore.loadFolded).chats.values()].flatMap(
      (chat) => chat.messages,
    );
    expect(messages.map((message) => message.id)).toEqual([
      "review-invitation:2026-11-11",
      "review-invitation:2026-11-15",
    ]);
    expect(
      (yield* publishDueReview(saved.version, Date.parse("2026-11-15T11:01:00Z"), restartedWriter))
        .published,
    ).toBe(false);
  }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
);
