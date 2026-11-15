import type { ContractDef } from "@eddy-works/never-rest/contract";
import * as Schema from "effect/Schema";
import { ReviewSchedule } from "@yatma/core";

export { ReviewSchedule } from "@yatma/core";
/** Account schedule controls; invitations are delivered through ordinary event sync. */
export const reviewContract = {
  readReviewSchedule: {
    method: "GET",
    path: "/api/review/schedule",
    output: Schema.toStandardSchemaV1(ReviewSchedule),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
  saveReviewSchedule: {
    method: "POST",
    path: "/api/review/schedule",
    body: Schema.toStandardSchemaV1(ReviewSchedule),
    output: Schema.toStandardSchemaV1(ReviewSchedule),
    errors: { unauthorized: 401, invalid_request: 422, service_unavailable: 503 },
  },
} as const satisfies ContractDef;
