import { InternalError, type ModelSettings, type SaveModelSettings } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

type SettingsRow = { readonly model: string; readonly encrypted_key: string };

/** Private per-account storage; this table is never exported or replicated. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS model_settings (
    id TEXT PRIMARY KEY, model TEXT NOT NULL, encrypted_key TEXT NOT NULL
  )`;
});

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encryptionKey(value: string | null) {
  if (!value) throw new Error("encryption_unconfigured");
  const bytes = decode(value);
  if (bytes.length !== 32) throw new Error("encryption_unconfigured");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Resolve keys at execution time; ciphertext is bound to the owning account. */
export function makeModelSettings(options: {
  readonly userId: string;
  readonly encryptionSecret: string | null;
  readonly serverKey: string | null;
  readonly defaultModel: string;
}) {
  const additionalData = new TextEncoder().encode(`yatma:openrouter:${options.userId}:v1`);
  const read = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows =
      yield* sql<SettingsRow>`SELECT model, encrypted_key FROM model_settings WHERE id = 'openrouter'`;
    return rows[0] ?? null;
  });
  const get = Effect.gen(function* () {
    const row = yield* read;
    const canSaveKey = yield* Effect.tryPromise({
      try: () => encryptionKey(options.encryptionSecret),
      catch: () => false,
    }).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    return {
      provider: "openrouter",
      model: row?.model ?? options.defaultModel,
      source: row ? "personal" : options.serverKey?.trim() ? "server" : "missing",
      canSaveKey,
    } satisfies ModelSettings;
  });
  const save = (input: SaveModelSettings) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (input.apiKey === undefined) {
        const existing = yield* read;
        if (!existing) return yield* new InternalError({ message: "personal_key_required" });
        yield* sql`UPDATE model_settings SET model = ${input.model} WHERE id = 'openrouter'`;
        return yield* get;
      }
      const apiKey = input.apiKey;
      const encrypted = yield* Effect.tryPromise({
        try: async () => {
          const key = await encryptionKey(options.encryptionSecret);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData },
            key,
            new TextEncoder().encode(apiKey),
          );
          return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
        },
        catch: () => new InternalError({ message: "model_settings_unavailable" }),
      });
      yield* sql`INSERT INTO model_settings(id, model, encrypted_key)
      VALUES ('openrouter', ${input.model}, ${encrypted})
      ON CONFLICT(id) DO UPDATE SET model = excluded.model, encrypted_key = excluded.encrypted_key`;
      return yield* get;
    });
  const remove = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM model_settings WHERE id = 'openrouter'`;
    return yield* get;
  });
  const resolve = Effect.gen(function* () {
    const row = yield* read;
    if (!row)
      return { model: options.defaultModel, openRouterKey: options.serverKey?.trim() || null };
    const openRouterKey = yield* Effect.tryPromise({
      try: async () => {
        const [iv, ciphertext] = row.encrypted_key.split(".");
        const key = await encryptionKey(options.encryptionSecret);
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: decode(iv!), additionalData },
          key,
          decode(ciphertext!),
        );
        return new TextDecoder().decode(plaintext);
      },
      catch: () => new InternalError({ message: "model_settings_unavailable" }),
    });
    return { model: row.model, openRouterKey };
  });
  return { get, save, remove, resolve };
}
