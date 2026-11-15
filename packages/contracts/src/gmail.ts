import type { ContractDef } from "@eddy-works/never-rest/contract";
import * as Schema from "effect/Schema";

import {
  GmailCompleteInput,
  GmailImportInput,
  GmailStatus,
  GmailConnection,
  GmailBeginOutput,
  GmailImportOutput,
  GmailDisconnectOutput,
} from "@yatma/core";
export {
  GmailCompleteInput,
  GmailImportInput,
  GmailStatus,
  GmailConnection,
  GmailBeginOutput,
  GmailImportOutput,
  GmailDisconnectOutput,
} from "@yatma/core";
const errors = {
  unauthorized: 401,
  invalid_request: 422,
  not_configured: 503,
  service_unavailable: 503,
} as const;
const empty = Schema.toStandardSchemaV1(Schema.Struct({}));
/** Read-only Gmail connection controls; credentials never cross this contract. */
export const gmailContract = {
  gmailStatus: {
    method: "GET",
    path: "/api/gmail/status",
    output: Schema.toStandardSchemaV1(GmailStatus),
    errors,
  },
  beginGmail: {
    method: "POST",
    path: "/api/gmail/begin",
    body: empty,
    output: Schema.toStandardSchemaV1(GmailBeginOutput),
    errors,
  },
  completeGmail: {
    method: "POST",
    path: "/api/gmail/complete",
    body: Schema.toStandardSchemaV1(GmailCompleteInput),
    output: Schema.toStandardSchemaV1(GmailConnection),
    errors,
  },
  importGmail: {
    method: "POST",
    path: "/api/gmail/import",
    body: Schema.toStandardSchemaV1(GmailImportInput),
    output: Schema.toStandardSchemaV1(GmailImportOutput),
    errors,
  },
  disconnectGmail: {
    method: "POST",
    path: "/api/gmail/disconnect",
    body: empty,
    output: Schema.toStandardSchemaV1(GmailDisconnectOutput),
    errors,
  },
} as const satisfies ContractDef;
