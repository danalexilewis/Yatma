import type { ContractDef } from "@eddy-works/never-rest/contract";
import { SyncPushInput, SyncPushResult } from "@yatma/core";
import * as Schema from "effect/Schema";

/** Existing event DTOs adapted to Standard Schema without a second schema definition. */
export const PushEventsInput = Schema.toStandardSchemaV1(SyncPushInput);
export const PushEventsOutput = Schema.toStandardSchemaV1(SyncPushResult);

/**
 * Unary sync boundary. Its HTTP mount awaits the atomic journal work in the plan;
 * WebSocket catch-up and live delivery remain separate host operations.
 */
export const syncContract = {
  pushEvents: {
    method: "POST",
    path: "/api/sync/events",
    body: PushEventsInput,
    output: PushEventsOutput,
    errors: {
      unauthorized: 401,
      invalid_event: 422,
      clock_skew: 409,
      event_conflict: 409,
    },
  },
} as const satisfies ContractDef;
