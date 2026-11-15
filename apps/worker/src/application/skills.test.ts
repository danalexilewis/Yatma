import { describe, expect, it } from "@effect/vitest";
import { MAX_ENABLED_SKILLS } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as Skills from "./skills.ts";

const now = "2026-11-16T00:00:00Z";
const input = {
  id: "skill_12345678",
  title: "Concise",
  instructions: "Use short action bullets.",
  enabled: true,
};
function withStore<A, E, R>(work: Effect.Effect<A, E, R>) {
  return Skills.migrate.pipe(
    Effect.andThen(work),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );
}
describe("account skills storage", () => {
  it.effect(
    "saves edits and enabled state, deletes idempotently and clears account configuration",
    () =>
      withStore(
        Effect.gen(function* () {
          expect((yield* Skills.list).skills).toEqual([]);
          expect((yield* Skills.save(input, now)).skills[0]).toMatchObject(input);
          const updated = yield* Skills.save({ ...input, title: "Detailed", enabled: false }, now);
          expect(updated.skills).toHaveLength(1);
          expect(updated.skills[0]).toMatchObject({ title: "Detailed", enabled: false });
          expect((yield* Skills.remove(input.id)).skills).toEqual([]);
          expect((yield* Skills.remove(input.id)).skills).toEqual([]);
          yield* Skills.save(input, now);
          yield* Skills.clear;
          expect((yield* Skills.list).skills).toEqual([]);
        }),
      ),
  );
  it.effect(
    "rejects an extra enabled skill atomically, then allows it after another is disabled",
    () =>
      withStore(
        Effect.gen(function* () {
          for (let index = 0; index < MAX_ENABLED_SKILLS; index++)
            yield* Skills.save({ ...input, id: `skill_0000000${index}` }, now);
          const failure = yield* Effect.flip(Skills.save(input, now));
          expect(failure._tag).toBe("InvalidRequest");
          expect((yield* Skills.list).skills).toHaveLength(MAX_ENABLED_SKILLS);
          yield* Skills.save({ ...input, id: "skill_00000000", enabled: false }, now);
          expect(
            (yield* Skills.save(input, now)).skills.filter((skill) => skill.enabled),
          ).toHaveLength(MAX_ENABLED_SKILLS);
          const sql = yield* SqlClient.SqlClient;
          expect(yield* sql`SELECT * FROM skills WHERE id = ${input.id}`).toHaveLength(1);
        }),
      ),
  );
  it("survives a SQLite reopen and stays isolated from another account's database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "yatma-skills-"));
    try {
      const filename = join(directory, "account-a.sqlite");
      await Effect.runPromise(
        Skills.migrate.pipe(
          Effect.andThen(Skills.save(input, now)),
          Effect.provide(NodeSqlite.layer({ filename })),
        ),
      );
      const reloaded = await Effect.runPromise(
        Skills.list.pipe(Effect.provide(NodeSqlite.layer({ filename }))),
      );
      expect(reloaded.skills[0]).toMatchObject(input);
      const another = await Effect.runPromise(
        Skills.migrate.pipe(
          Effect.andThen(Skills.list),
          Effect.provide(NodeSqlite.layer({ filename: join(directory, "account-b.sqlite") })),
        ),
      );
      expect(another.skills).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
