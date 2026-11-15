import type { ContractDef } from "@eddy-works/never-rest/contract";
import { ModelSettings, SaveModelSettings } from "@yatma/core";
import * as Schema from "effect/Schema";

/** Account-owned model credentials stay outside the replicated event journal. */
export const modelSettingsContract = {
  getModelSettings: {
    method: "GET",
    path: "/api/settings/model",
    output: Schema.toStandardSchemaV1(ModelSettings),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
  saveModelSettings: {
    method: "PUT",
    path: "/api/settings/model",
    body: Schema.toStandardSchemaV1(SaveModelSettings),
    output: Schema.toStandardSchemaV1(ModelSettings),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
  removeModelSettings: {
    method: "DELETE",
    path: "/api/settings/model",
    output: Schema.toStandardSchemaV1(ModelSettings),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
} as const satisfies ContractDef;
