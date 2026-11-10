import { railError, type RailError } from "@eddy-works/never-rest";
import { definePolicy } from "@eddy-works/never-rest/policy";
import { serve, type Handlers } from "@eddy-works/never-rest/server";
import { syncContract } from "@yatma/contracts/sync";
import { turnContract } from "@yatma/contracts/turn";
import type {
  SyncPushInput,
  SyncPushResult,
  TurnGetResult,
  TurnReceipt,
  TurnStartInput,
  TurnStopInput,
  TurnStopResult,
} from "@yatma/core";
import { err, ok, type Result } from "neverthrow";

type Principal = { readonly userId: string };

/** Host-owned RPC bridge; stream observation stays on the authenticated socket. */
export interface UserApiContext {
  readonly pushEvents: (userId: string, input: SyncPushInput) => Promise<SyncPushResult>;
  readonly startTurn: (userId: string, input: TurnStartInput) => Promise<TurnReceipt>;
  readonly getTurn: (userId: string, turnId: string) => Promise<TurnGetResult>;
  readonly stopTurn: (userId: string, input: TurnStopInput) => Promise<TurnStopResult>;
}

type SyncCodes = "unauthorized" | "invalid_event" | "clock_skew" | "event_conflict" | "service_unavailable";
type TurnStartCodes = "unauthorized" | "invalid_request" | "budget_exceeded" | "service_unavailable";
type TurnReadCodes = "unauthorized" | "not_found" | "service_unavailable";
type TurnStopCodes = TurnReadCodes | "invalid_request";

function failure<C extends string>(
  code: C,
  message: string,
  nextStep: string,
  retryable = false,
): RailError<C> {
  return railError(code, message, { origin: "yatma-user-api", nextStep, retryable });
}

function tagOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return null;
  return String((error as { readonly _tag: unknown })._tag);
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { readonly message: unknown }).message);
  }
  return "";
}

function syncFailure(error: unknown): RailError<SyncCodes> {
  const tag = tagOf(error);
  const message = messageOf(error);
  if (tag === "ClockSkew") {
    return failure("clock_skew", "The device clock is out of sync.", "Correct the device clock, then retry.");
  }
  if (tag === "InvalidRequest" && message.includes("event_conflict")) {
    return failure("event_conflict", "An event ID already exists with different content.", "Refresh the local state and contact support if the conflict continues.");
  }
  if (tag === "InvalidRequest") {
    return failure("invalid_event", "The event batch was rejected.", "Refresh local state and retry the edit.");
  }
  if (tag === "RpcClientError") {
    return failure("service_unavailable", "Sync is temporarily unavailable.", "Retry when the connection is available.", true);
  }
  throw new Error("sync handler failed");
}

function turnStartFailure(error: unknown): RailError<TurnStartCodes> {
  const tag = tagOf(error);
  if (tag === "InvalidRequest") {
    return failure("invalid_request", "The turn request conflicts with an existing request.", "Retry with a new request ID.");
  }
  if (tag === "BudgetExceeded") {
    return failure("budget_exceeded", "The daily model usage limit has been reached.", "Wait for the daily reset or reduce the request.");
  }
  if (tag === "RpcClientError") {
    return failure("service_unavailable", "Turn service is temporarily unavailable.", "Retry with the same request ID.", true);
  }
  throw new Error("turn start handler failed");
}

function turnReadFailure(error: unknown): RailError<TurnReadCodes> {
  if (tagOf(error) === "NotFound") {
    return failure("not_found", "That turn could not be found.", "Refresh the chat and retry.");
  }
  if (tagOf(error) === "RpcClientError") {
    return failure("service_unavailable", "Turn service is temporarily unavailable.", "Retry when the connection is available.", true);
  }
  throw new Error("turn handler failed");
}

async function invoke<A, C extends string>(
  task: () => Promise<A>,
  onError: (error: unknown) => RailError<C>,
): Promise<Result<A, RailError<C>>> {
  try {
    return ok(await task());
  } catch (error) {
    return err(onError(error));
  }
}

function unauthorized<C extends string>(): RailError<C> {
  return failure("unauthorized" as C, "Sign in to use this operation.", "Sign in again and retry.");
}

/** Mount authenticated unary JSON contracts beside the existing WebSocket RPC host. */
export function createUserApi(principal: Principal | null) {
  const syncHandlers: Handlers<typeof syncContract, UserApiContext, Principal> = {
    pushEvents: ({ body, principal, context }) => {
      if (!principal) return err(unauthorized<SyncCodes>());
      return invoke(
        () => context.pushEvents(principal.userId, body),
        syncFailure,
      );
    },
  };
  const turnHandlers: Handlers<typeof turnContract, UserApiContext, Principal> = {
    startTurn: ({ body, principal, context }) => {
      if (!principal) return err(unauthorized<TurnStartCodes>());
      return invoke(() => context.startTurn(principal.userId, body), turnStartFailure);
    },
    getTurn: ({ params, principal, context }) => {
      if (!principal) return err(unauthorized<TurnReadCodes>());
      return invoke(() => context.getTurn(principal.userId, params.turnId), turnReadFailure);
    },
    stopTurn: ({ params, body, principal, context }) => {
      if (!principal) return err(unauthorized<TurnStopCodes>());
      if (params.turnId !== body.turnId) {
        return err(failure("invalid_request", "The turn ID in the path and body must match.", "Refresh the chat and retry."));
      }
      return invoke(() => context.stopTurn(principal.userId, body), turnReadFailure);
    },
  };
  const syncPolicy = definePolicy<typeof syncContract, Principal>(syncContract, {
    verify: () => principal ? ok(principal) : err(unauthorized<"unauthorized">()),
    operations: { pushEvents: () => ok(undefined) },
    disclosure: () => "public",
  });
  const turnPolicy = definePolicy<typeof turnContract, Principal>(turnContract, {
    verify: () => principal ? ok(principal) : err(unauthorized<"unauthorized">()),
    operations: {
      startTurn: () => ok(undefined),
      getTurn: () => ok(undefined),
      stopTurn: () => ok(undefined),
    },
    disclosure: () => "public",
  });
  const syncApi = serve(syncContract, syncHandlers, {
    origin: "yatma-sync",
    policy: syncPolicy,
  });
  const turnApi = serve(turnContract, turnHandlers, {
    origin: "yatma-turns",
    policy: turnPolicy,
  });

  return async (request: Request, context: UserApiContext): Promise<Response> => {
    const syncResult = await syncApi.handle(request, context);
    if (syncResult.matched) return syncResult.response;
    const turnResult = await turnApi.handle(request, context);
    if (turnResult.matched) return turnResult.response;
    return new Response("Not Found", { status: 404 });
  };
}
