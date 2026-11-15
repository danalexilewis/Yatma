import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import { makeModelSettings, migrate } from "./modelSettings.ts";

const secret = btoa("a".repeat(32));
const key = "sk-or-v1-test-personal-secret";
function service(userId = "user-a", encryptionSecret: string | null = secret) {
  return makeModelSettings({
    userId,
    encryptionSecret,
    serverKey: "server-fallback",
    defaultModel: "openai/gpt-4o-mini",
  });
}
function withStore<A, E, R>(work: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    yield* migrate;
    yield* EventStore.migrate;
    return yield* work;
  }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" })));
}

describe("account model credentials", () => {
  it.effect("persists encrypted keys across service recreation without adding journal events", () =>
    withStore(
      Effect.gen(function* () {
        const settings = service();
        expect((yield* settings.get).source).toBe("server");
        const status = yield* settings.save({ apiKey: key, model: "anthropic/claude-haiku-4.5" });
        expect(status).toMatchObject({ source: "personal", canSaveKey: true });
        expect(JSON.stringify(status)).not.toContain(key);
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql`SELECT * FROM model_settings`;
        expect(JSON.stringify(rows)).not.toContain(key);
        const events = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM events`;
        expect(events[0]?.count).toBe(0);
        expect(yield* service().resolve).toEqual({
          model: "anthropic/claude-haiku-4.5",
          openRouterKey: key,
        });
        yield* settings.remove;
        expect(yield* service().resolve).toEqual({
          model: "openai/gpt-4o-mini",
          openRouterKey: "server-fallback",
        });
      }),
    ),
  );

  it.effect("rejects ciphertext in another account or with another encryption secret", () =>
    withStore(
      Effect.gen(function* () {
        yield* service().save({ apiKey: key, model: "openai/gpt-4o-mini" });
        const other = yield* Effect.flip(service("user-b").resolve);
        expect(other.message).toBe("model_settings_unavailable");
        const rotated = yield* Effect.flip(service("user-a", btoa("b".repeat(32))).resolve);
        expect(rotated.message).toBe("model_settings_unavailable");
        expect(JSON.stringify(rotated)).not.toContain(key);
      }),
    ),
  );

  it.effect("does not save plaintext when server encryption is unconfigured", () =>
    withStore(
      Effect.gen(function* () {
        const settings = service("user-a", null);
        expect((yield* settings.get).canSaveKey).toBe(false);
        yield* Effect.flip(settings.save({ apiKey: key, model: "openai/gpt-4o-mini" }));
        expect((yield* settings.get).source).toBe("server");
      }),
    ),
  );

  it.effect("changes the model without reading or replacing an existing encrypted credential", () =>
    withStore(
      Effect.gen(function* () {
        yield* service().save({ apiKey: key, model: "openai/gpt-4o-mini" });
        const sql = yield* SqlClient.SqlClient;
        const before = yield* sql`SELECT encrypted_key FROM model_settings`;
        const status = yield* service().save({ model: "example/another-model" });
        expect(status.model).toBe("example/another-model");
        expect(status.source).toBe("personal");
        expect(yield* sql`SELECT encrypted_key FROM model_settings`).toEqual(before);
        expect(yield* service().resolve).toEqual({
          model: "example/another-model",
          openRouterKey: key,
        });
      }),
    ),
  );

  it.effect("requires a personal credential before saving a model alone", () =>
    withStore(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(service().save({ model: "example/another-model" }));
        expect(failure.message).toBe("personal_key_required");
        expect(yield* service().resolve).toEqual({
          model: "openai/gpt-4o-mini",
          openRouterKey: "server-fallback",
        });
      }),
    ),
  );
});
