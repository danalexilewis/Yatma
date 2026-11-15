import { createGmailApi, type GmailApiContext } from "./http/gmail.ts";
import { createReviewApi, type ReviewApiContext } from "./http/review.ts";
// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { optionalRedacted, verifyClerkRequest, type AuthConfig } from "./auth.ts";
import { createHealthApi } from "./http/health.ts";
import { createUserApi, type UserApiContext } from "./http/user.ts";
import { createSkillsApi, type SkillsApiContext } from "./http/skills.ts";
import { createModelSettingsApi, type ModelSettingsApiContext } from "./http/modelSettings.ts";
import { corsHeaders } from "./http/cors.ts";
import { UserSpace, UserSpaceLive } from "./UserSpace.ts";

/**
 * Edge Worker: Clerk (or dev stub) on connect, then forward the socket to
 * `UserSpace` addressed by Clerk user id.
 */
export class Api extends Cloudflare.Worker<Api, {}, UserSpace>()("Api") {}

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const clerkSecretKey = optionalRedacted(
      yield* Config.option(Config.Redacted("CLERK_SECRET_KEY")),
    );
    const clerkPublishableKey = Option.getOrNull(
      yield* Config.option(Config.String("CLERK_PUBLISHABLE_KEY")),
    );
    const clerkJwtAudience = Option.getOrNull(
      yield* Config.option(Config.String("CLERK_JWT_AUDIENCE")),
    );
    const openRouterApiKey = optionalRedacted(
      yield* Config.option(Config.Redacted("OPENROUTER_API_KEY")),
    );
    const openRouterModel = yield* Config.String("OPENROUTER_MODEL").pipe(
      Config.withDefault("openai/gpt-4o-mini"),
    );
    const encryptionKey = optionalRedacted(
      yield* Config.option(Config.Redacted("AI_SETTINGS_ENCRYPTION_KEY")),
    );
    const corsAllowedOrigins = yield* Config.String("CORS_ALLOWED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const usageCap = yield* Config.Number("USAGE_DAILY_TOKEN_CAP").pipe(
      Config.withDefault(500_000),
    );

    const gmailClientId = Option.getOrNull(yield* Config.option(Config.String("GMAIL_CLIENT_ID")));
    const gmailClientSecret = optionalRedacted(
      yield* Config.option(Config.Redacted("GMAIL_CLIENT_SECRET")),
    );
    const gmailRedirectUri = Option.getOrNull(
      yield* Config.option(Config.String("GMAIL_REDIRECT_URI")),
    );
    return {
      main: import.meta.filename,
      compatibility: {
        date: "2026-05-22",
        flags: ["nodejs_compat"],
      },
      env: {
        STAGE: stage,
        GMAIL_CLIENT_ID: gmailClientId ?? "",
        GMAIL_CLIENT_SECRET: gmailClientSecret ?? "",
        GMAIL_REDIRECT_URI: gmailRedirectUri ?? "",
        CLERK_SECRET_KEY: clerkSecretKey ?? "",
        CLERK_PUBLISHABLE_KEY: clerkPublishableKey ?? "",
        CLERK_JWT_AUDIENCE: clerkJwtAudience ?? "yatma",
        OPENROUTER_API_KEY: openRouterApiKey ?? "",
        OPENROUTER_MODEL: openRouterModel,
        AI_SETTINGS_ENCRYPTION_KEY: encryptionKey ?? "",
        CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
        USAGE_DAILY_TOKEN_CAP: String(usageCap),
      },
    };
  }).pipe(Effect.orDie),
  Effect.gen(function* () {
    const userSpaces = yield* UserSpace;
    const { stage } = yield* Alchemy.Stack;
    const healthApi = createHealthApi(stage);
    const allowedOrigins = yield* Config.String("CORS_ALLOWED_ORIGINS").pipe(
      Config.withDefault(""),
    );

    const clerkSecretRaw = yield* Config.option(Config.Redacted("CLERK_SECRET_KEY"));
    const authConfig: AuthConfig = {
      stage,
      clerkSecretKey: optionalRedacted(clerkSecretRaw),
      clerkPublishableKey: Option.getOrNull(
        yield* Config.option(Config.String("CLERK_PUBLISHABLE_KEY")),
      ),
      clerkJwtAudience: Option.getOrNull(yield* Config.option(Config.String("CLERK_JWT_AUDIENCE"))),
    };
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const raw = request.source as Request;
        const url = new URL(raw.url);
        if (url.protocol !== "https:")
          return HttpServerResponse.text("HTTPS required", { status: 400 });
        const headers = corsHeaders(raw, stage, allowedOrigins);
        if (!headers) return HttpServerResponse.text("Origin not allowed", { status: 403 });
        if (raw.method === "OPTIONS") return HttpServerResponse.empty({ status: 204, headers });
        const response = yield* Effect.gen(function* () {
          if (url.pathname === "/api/skills" || url.pathname.startsWith("/api/skills/")) {
            const verified = yield* verifyClerkRequest(authConfig, raw).pipe(Effect.option);
            const principal = Option.isSome(verified) ? verified.value : null;
            async function ownedClient(id: string) {
              if (id !== principal?.userId) throw new Error("principal mismatch");
              return Effect.runPromise(userSpaces.getByName(id));
            }
            const context: SkillsApiContext = {
              listSkills: async (id) => {
                const client = await ownedClient(id);
                return Effect.runPromise(client["skills.list"]());
              },
              saveSkill: async (id, input) => {
                const client = await ownedClient(id);
                const result = await Effect.runPromise(
                  client["skills.save"](input).pipe(Effect.result),
                );
                if (result._tag === "Failure") throw result.failure;
                return result.success;
              },
              deleteSkill: async (id, skillId) => {
                const client = await ownedClient(id);
                return Effect.runPromise(client["skills.delete"]({ id: skillId }));
              },
            };
            const result = yield* Effect.promise(() =>
              createSkillsApi(principal).handle(raw, context),
            );
            const response = result.matched
              ? result.response
              : new Response("Not found", { status: 404 });
            response.headers.set("Cache-Control", "no-store");
            return HttpServerResponse.fromWeb(response);
          }

          if (url.pathname.startsWith("/api/settings/")) {
            const verified = yield* verifyClerkRequest(authConfig, raw).pipe(Effect.option);
            const principal = Option.isSome(verified) ? verified.value : null;
            const context: ModelSettingsApiContext = {
              getModelSettings: async (id) => {
                if (id !== principal?.userId) throw new Error("principal mismatch");
                const client = await Effect.runPromise(userSpaces.getByName(id));
                return Effect.runPromise(client["model.settings.get"]());
              },
              saveModelSettings: async (id, input) => {
                if (id !== principal?.userId) throw new Error("principal mismatch");
                const client = await Effect.runPromise(userSpaces.getByName(id));
                return Effect.runPromise(client["model.settings.save"](input));
              },
              removeModelSettings: async (id) => {
                if (id !== principal?.userId) throw new Error("principal mismatch");
                const client = await Effect.runPromise(userSpaces.getByName(id));
                return Effect.runPromise(client["model.settings.remove"]());
              },
            };
            const result = yield* Effect.promise(() =>
              createModelSettingsApi(principal).handle(raw, context),
            );
            const resultResponse = result.matched
              ? result.response
              : new Response("Not found", { status: 404 });
            resultResponse.headers.set("Cache-Control", "no-store");
            return HttpServerResponse.fromWeb(resultResponse);
          }

          if (url.pathname === "/health" || url.pathname === "/") {
            if (raw.headers.get("upgrade")?.toLowerCase() === "websocket") {
              // fall through to auth + DO
            } else {
              const response = yield* Effect.promise(() => healthApi(raw, undefined));
              return HttpServerResponse.fromWeb(response);
            }
          }

          if (url.pathname.startsWith("/api/review/") || url.pathname.startsWith("/api/gmail/")) {
            const verified = yield* verifyClerkRequest(authConfig, raw).pipe(Effect.option);
            if (Option.isNone(verified))
              return HttpServerResponse.text("Unauthorized", { status: 401 });
            const { userId } = verified.value;
            const client = yield* userSpaces.getByName(userId);
            function owned(id: string) {
              if (id !== userId) throw new Error("principal mismatch");
            }
            const context: GmailApiContext & ReviewApiContext = {
              readReviewSchedule: async (id) => {
                owned(id);
                return Effect.runPromise(client["review.schedule.get"]());
              },
              saveReviewSchedule: async (id, input) => {
                owned(id);
                return Effect.runPromise(client["review.schedule.set"](input));
              },
              gmailStatus: async (id) => {
                owned(id);
                return Effect.runPromise(client["gmail.status"]());
              },
              beginGmail: async (id) => {
                owned(id);
                return Effect.runPromise(client["gmail.begin"]());
              },
              completeGmail: async (id, input) => {
                owned(id);
                return Effect.runPromise(client["gmail.complete"](input));
              },
              importGmail: async (id, input) => {
                owned(id);
                return Effect.runPromise(client["gmail.import"](input));
              },
              disconnectGmail: async (id) => {
                owned(id);
                return Effect.runPromise(client["gmail.disconnect"]());
              },
            };
            const api = url.pathname.startsWith("/api/review/")
              ? createReviewApi({ userId })
              : createGmailApi({ userId });
            const result = yield* Effect.promise(() => api.handle(raw, context));
            return result.matched
              ? HttpServerResponse.fromWeb(result.response)
              : HttpServerResponse.text("Not found", { status: 404 });
          }

          const isUserApiRoute =
            url.pathname.startsWith("/api/sync/") || url.pathname.startsWith("/api/turns");
          if (isUserApiRoute) {
            const verified = yield* verifyClerkRequest(authConfig, raw).pipe(
              Effect.mapError(() => undefined),
              Effect.option,
            );
            const fallbackContext: UserApiContext = {
              pushEvents: async () => {
                throw new Error("unavailable");
              },
              startTurn: async () => {
                throw new Error("unavailable");
              },
              getTurn: async () => {
                throw new Error("unavailable");
              },
              stopTurn: async () => {
                throw new Error("unavailable");
              },
            };
            if (Option.isNone(verified)) {
              const response = yield* Effect.promise(() =>
                createUserApi(null)(raw, fallbackContext),
              );
              return HttpServerResponse.fromWeb(response);
            }
            const { userId } = verified.value;
            const client = yield* userSpaces.getByName(userId);
            const context: UserApiContext = {
              pushEvents: (targetUserId, input) =>
                targetUserId === userId
                  ? Effect.runPromise(client["sync.push"](input))
                  : Promise.reject(new Error("principal mismatch")),
              startTurn: (targetUserId, input) =>
                targetUserId === userId
                  ? Effect.runPromise(client["turn.start"](input))
                  : Promise.reject(new Error("principal mismatch")),
              getTurn: (targetUserId, turnId, eventSchemaVersion) =>
                targetUserId === userId
                  ? Effect.runPromise(client["turn.get"]({ turnId, eventSchemaVersion }))
                  : Promise.reject(new Error("principal mismatch")),
              stopTurn: (targetUserId, input) =>
                targetUserId === userId
                  ? Effect.runPromise(client["turn.stop"](input))
                  : Promise.reject(new Error("principal mismatch")),
            };
            const response = yield* Effect.promise(() => createUserApi({ userId })(raw, context));
            return HttpServerResponse.fromWeb(response);
          }

          const verified = yield* verifyClerkRequest(authConfig, raw).pipe(
            Effect.mapError(() => undefined),
            Effect.option,
          );
          if (Option.isNone(verified)) {
            return HttpServerResponse.text("Unauthorized", { status: 401 });
          }

          const { userId } = verified.value;
          return yield* userSpaces.fetch(userId, request);
        });
        return HttpServerResponse.setHeaders(response, {
          ...headers,
          "Strict-Transport-Security": "max-age=31536000",
        });
      }),
    };
  }).pipe(Effect.provide(UserSpaceLive)),
);

export default ApiLive;
