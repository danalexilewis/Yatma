import {
  InvalidRequest,
  MAX_ENABLED_SKILLS,
  MAX_SKILLS,
  SaveSkill,
  Skill,
  type SkillList,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

type SkillRow = {
  id: string;
  title: string;
  instructions: string;
  enabled: number;
  updated_at: string;
};

/** Private account configuration, separate from task history and assistant-editable knowledge. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, instructions TEXT NOT NULL,
    enabled INTEGER NOT NULL, updated_at TEXT NOT NULL
  )`;
});
export const list = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<SkillRow>`SELECT * FROM skills ORDER BY title COLLATE NOCASE, id`;
  const skills = yield* Effect.forEach(rows, (row) =>
    Schema.decodeUnknownEffect(Skill)({
      id: row.id,
      title: row.title,
      instructions: row.instructions,
      enabled: row.enabled === 1,
      updatedAt: row.updated_at,
    }),
  );
  return { skills } satisfies SkillList;
});

/** The host serializes saves with account deletion and other skill writes. */
export function save(input: SaveSkill, now: string) {
  return Effect.gen(function* () {
    const checked = yield* Schema.decodeUnknownEffect(SaveSkill)(input);
    const current = yield* list;
    if (
      !current.skills.some((skill) => skill.id === checked.id) &&
      current.skills.length >= MAX_SKILLS
    )
      return yield* new InvalidRequest({
        message: `You can save up to ${MAX_SKILLS} skills. Remove one before adding another.`,
      });
    if (
      checked.enabled &&
      current.skills.filter((skill) => skill.enabled && skill.id !== checked.id).length >=
        MAX_ENABLED_SKILLS
    )
      return yield* new InvalidRequest({
        message: `You can enable up to ${MAX_ENABLED_SKILLS} skills at once. Disable one first.`,
      });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO skills(id, title, instructions, enabled, updated_at)
      VALUES (${checked.id}, ${checked.title}, ${checked.instructions}, ${checked.enabled ? 1 : 0}, ${now})
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, instructions = excluded.instructions,
        enabled = excluded.enabled, updated_at = excluded.updated_at`;
    return yield* list;
  });
}

export function remove(id: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM skills WHERE id = ${id}`;
    return yield* list;
  });
}

export const clear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM skills`;
});
