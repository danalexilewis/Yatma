import type { ContractDef } from "@eddy-works/never-rest/contract";
import { TurnGetInput, TurnGetResult, TurnStartInput, TurnReceipt, TurnStopInput, TurnStopResult } from "@yatma/core";
import * as Schema from "effect/Schema";

/** Unary turn controls share the core DTOs; progress remains on the host stream. */
export const StartTurnInput = Schema.toStandardSchemaV1(TurnStartInput);
export const StartTurnOutput = Schema.toStandardSchemaV1(TurnReceipt);
export const GetTurnInput = Schema.toStandardSchemaV1(TurnGetInput);
export const GetTurnOutput = Schema.toStandardSchemaV1(TurnGetResult);
export const StopTurnInput = Schema.toStandardSchemaV1(TurnStopInput);
export const StopTurnOutput = Schema.toStandardSchemaV1(TurnStopResult);

export const turnContract = {
  startTurn: {
    method: "POST",
    path: "/api/turns",
    body: StartTurnInput,
    output: StartTurnOutput,
    errors: { unauthorized: 401, invalid_request: 422, budget_exceeded: 429, service_unavailable: 503 },
  },
  getTurn: {
    method: "GET",
    path: "/api/turns/:turnId",
    params: Schema.toStandardSchemaV1(Schema.Struct({ turnId: Schema.String })),
    output: GetTurnOutput,
    errors: { unauthorized: 401, not_found: 404, service_unavailable: 503 },
  },
  stopTurn: {
    method: "POST",
    path: "/api/turns/:turnId/stop",
    params: Schema.toStandardSchemaV1(Schema.Struct({ turnId: Schema.String })),
    body: StopTurnInput,
    output: StopTurnOutput,
    errors: { unauthorized: 401, not_found: 404, invalid_request: 422, service_unavailable: 503 },
  },
} as const satisfies ContractDef;
