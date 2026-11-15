import * as Schema from "effect/Schema";
import { StackTimezone } from "./stackSchemas.ts";

export const GmailCompleteInput = Schema.Struct({
  code: Schema.String.check(Schema.isNonEmpty()),
  state: Schema.String.check(Schema.isNonEmpty()),
});
export const GmailImportInput = Schema.Struct({ pageToken: Schema.optional(Schema.String) });
export const GmailStatus = Schema.Struct({
  configured: Schema.Boolean,
  connected: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
});
export const GmailConnection = Schema.Struct({
  connected: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
});
export const GmailBeginOutput = Schema.Struct({ authorizationUrl: Schema.String });
export const GmailImportOutput = Schema.Struct({
  received: Schema.Number,
  nextPageToken: Schema.NullOr(Schema.String),
});
export const GmailDisconnectOutput = Schema.Struct({ connected: Schema.Literal(false) });
export const ReviewSchedule = Schema.Struct({
  enabled: Schema.Boolean,
  localTime: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  timezone: StackTimezone,
});
export type ReviewSchedule = typeof ReviewSchedule.Type;

export type GmailCompleteInput = typeof GmailCompleteInput.Type;
export type GmailImportInput = typeof GmailImportInput.Type;
