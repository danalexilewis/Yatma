import type { ContractDef } from "@eddy-works/never-rest/contract";
import * as Schema from "effect/Schema";

/** Public readiness response; the root path is an alias of `/health`. */
export const HealthResponse = Schema.toStandardSchemaV1(
  Schema.Struct({
    ok: Schema.Literal(true),
    service: Schema.Literal("yatma"),
    stage: Schema.String,
  }),
);

/** Shared JSON contract consumed by the Worker, typed clients, and boundary tests. */
export const healthContract = {
  getHealth: {
    method: "GET",
    path: "/health",
    output: HealthResponse,
    errors: {},
  },
  getRoot: {
    method: "GET",
    path: "/",
    output: HealthResponse,
    errors: {},
  },
} as const satisfies ContractDef;
