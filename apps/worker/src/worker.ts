// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { optionalRedacted, verifyClerkRequest, type AuthConfig } from "./auth.ts";
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
    const usageCap = yield* Config.Number("USAGE_MONTHLY_TOKEN_CAP").pipe(
      Config.withDefault(500_000),
    );

    return {
      main: import.meta.filename,
      compatibility: {
        date: "2026-05-22",
        flags: ["nodejs_compat"],
      },
      env: {
        STAGE: stage,
        CLERK_SECRET_KEY: clerkSecretKey ?? "",
        CLERK_PUBLISHABLE_KEY: clerkPublishableKey ?? "",
        CLERK_JWT_AUDIENCE: clerkJwtAudience ?? "yatma",
        OPENROUTER_API_KEY: openRouterApiKey ?? "",
        OPENROUTER_MODEL: openRouterModel,
        USAGE_MONTHLY_TOKEN_CAP: String(usageCap),
      },
    };
  }).pipe(Effect.orDie),
  Effect.gen(function* () {
    const userSpaces = yield* UserSpace;
    const { stage } = yield* Alchemy.Stack;

    const clerkSecretRaw = yield* Config.option(Config.Redacted("CLERK_SECRET_KEY"));
    const authConfig: AuthConfig = {
      stage,
      clerkSecretKey: optionalRedacted(clerkSecretRaw),
      clerkPublishableKey: Option.getOrNull(
        yield* Config.option(Config.String("CLERK_PUBLISHABLE_KEY")),
      ),
      clerkJwtAudience: Option.getOrNull(
        yield* Config.option(Config.String("CLERK_JWT_AUDIENCE")),
      ),
    };

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const raw = request.source as Request;
        const url = new URL(raw.url);

        if (url.pathname === "/health" || url.pathname === "/") {
          if (raw.headers.get("upgrade")?.toLowerCase() === "websocket") {
            // fall through to auth + DO
          } else {
            return HttpServerResponse.json({
              ok: true,
              service: "yatma",
              stage,
            });
          }
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
      }),
    };
  }).pipe(Effect.provide(UserSpaceLive)),
);

export default ApiLive;
