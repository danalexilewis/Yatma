// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { createClerkClient, verifyToken } from "@clerk/backend";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class AuthFailed extends Schema.TaggedError<AuthFailed>()("AuthFailed", {
  reason: Schema.String,
}) {}

export type AuthConfig = {
  readonly stage: string;
  readonly clerkSecretKey: Redacted.Redacted<string> | null;
  readonly clerkPublishableKey: string | null;
  readonly clerkJwtAudience: string | null;
};

const DEV_TEST_TOKEN = "test-token";
const DEV_TEST_USER_ID = "user_test";

/** Pull Bearer token from Authorization, `token` query, or first WS subprotocol. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();
  const protocol = request.headers.get("sec-websocket-protocol");
  if (protocol) {
    const first = protocol.split(",")[0]?.trim();
    if (first && first !== "yatma") return first;
  }
  return null;
}

function hasExpectedAudience(audience: unknown, expected: string): boolean {
  return typeof audience === "string"
    ? audience === expected
    : Array.isArray(audience) &&
        audience.some((entry) => typeof entry === "string" && entry === expected);
}

/**
 * Verify Clerk session JWT, or accept `test-token` in STAGE=dev when no secret.
 */
export function verifyClerkRequest(config: AuthConfig, request: Request) {
  return Effect.gen(function* () {
    const token = extractBearerToken(request);
    if (!token) {
      return yield* Effect.fail(new AuthFailed({ reason: "missing_bearer" }));
    }

    const secret = config.clerkSecretKey
      ? Redacted.value(config.clerkSecretKey).trim()
      : "";

    if (!secret) {
      if (config.stage === "dev" && token === DEV_TEST_TOKEN) {
        return { userId: DEV_TEST_USER_ID, mode: "dev_stub" as const };
      }
      return yield* Effect.fail(new AuthFailed({ reason: "clerk_secret_missing" }));
    }

    const audience = config.clerkJwtAudience?.trim() || null;

    const verified = yield* Effect.tryPromise({
      try: () =>
        verifyToken(token, {
          secretKey: secret,
          ...(audience ? { audience } : {}),
        }),
      catch: (cause) => new AuthFailed({ reason: `verify_failed:${String(cause)}` }),
    });

    if (!verified.sub) {
      return yield* Effect.fail(new AuthFailed({ reason: "missing_sub" }));
    }
    if (audience && !hasExpectedAudience(verified.aud, audience)) {
      // Fall through to OAuth authenticateRequest when audience mismatches.
      const oauth = yield* verifyClerkOAuth(config, token, secret);
      return oauth;
    }

    return { userId: verified.sub, mode: "clerk_session" as const };
  }).pipe(
    Effect.catchTag("AuthFailed", (err) => {
      if (!config.clerkSecretKey || !config.clerkPublishableKey) {
        return Effect.fail(err);
      }
      const secret = Redacted.value(config.clerkSecretKey).trim();
      if (!secret) return Effect.fail(err);
      return verifyClerkOAuth(config, extractBearerToken(request) ?? "", secret).pipe(
        Effect.catch(() => Effect.fail(err)),
      );
    }),
  );
}

function verifyClerkOAuth(config: AuthConfig, token: string, secret: string) {
  return Effect.tryPromise({
    try: async () => {
      const client = createClerkClient({
        secretKey: secret,
        ...(config.clerkPublishableKey
          ? { publishableKey: config.clerkPublishableKey }
          : {}),
      });
      const state = await client.authenticateRequest(
        new Request("https://yatma.local", {
          headers: { authorization: `Bearer ${token}` },
        }),
        { acceptsToken: "oauth_token" },
      );
      const auth = state.toAuth();
      if (!state.isAuthenticated || !auth.userId) {
        throw new Error("oauth_not_authenticated");
      }
      return { userId: auth.userId, mode: "clerk_oauth" as const };
    },
    catch: (cause) => new AuthFailed({ reason: `oauth_failed:${String(cause)}` }),
  });
}

export function optionalRedacted(
  value: Option.Option<Redacted.Redacted<string>>,
): Redacted.Redacted<string> | null {
  if (Option.isNone(value)) return null;
  const raw = Redacted.value(value.value).trim();
  return raw.length > 0 ? value.value : null;
}

function clerkSecretFromEnv(): string {
  const raw = globalThis.process?.env?.CLERK_SECRET_KEY;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Best-effort Clerk user deletion when `CLERK_SECRET_KEY` is set.
 * No-ops (succeeds) when the secret is missing so local/dev DO clears still work.
 */
export function deleteClerkUser(userId: string) {
  return Effect.gen(function* () {
    const secret = clerkSecretFromEnv();
    if (!secret) {
      return { deleted: false as const, reason: "clerk_secret_missing" as const };
    }
    yield* Effect.tryPromise({
      try: async () => {
        const client = createClerkClient({ secretKey: secret });
        await client.users.deleteUser(userId);
      },
      catch: (cause) =>
        new AuthFailed({ reason: `clerk_delete_failed:${String(cause)}` }),
    });
    return { deleted: true as const, reason: "ok" as const };
  });
}
