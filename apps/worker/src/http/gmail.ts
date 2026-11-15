import { railError } from "@eddy-works/never-rest";
import { definePolicy } from "@eddy-works/never-rest/policy";
import { serve, type Handlers } from "@eddy-works/never-rest/server";
import {
  gmailContract,
  type GmailCompleteInput,
  type GmailImportInput,
} from "@yatma/contracts/gmail";
import { err, ok } from "neverthrow";

type Principal = { readonly userId: string };
export interface GmailApiContext {
  readonly gmailStatus: (
    userId: string,
  ) => Promise<{ configured: boolean; connected: boolean; email: string | null }>;
  readonly beginGmail: (userId: string) => Promise<{ authorizationUrl: string }>;
  readonly completeGmail: (
    userId: string,
    input: typeof GmailCompleteInput.Type,
  ) => Promise<{ connected: boolean; email: string | null }>;
  readonly importGmail: (
    userId: string,
    input: typeof GmailImportInput.Type,
  ) => Promise<{ received: number; nextPageToken: string | null }>;
  readonly disconnectGmail: (userId: string) => Promise<{ connected: false }>;
}
function unauthorized() {
  return railError("unauthorized", "Sign in to connect Gmail.", {
    origin: "yatma-gmail",
    nextStep: "Sign in and retry.",
  });
}
async function invoke<A>(run: () => Promise<A>) {
  try {
    return ok(await run());
  } catch {
    return err(
      railError("service_unavailable", "Gmail operation could not finish.", {
        origin: "yatma-gmail",
        nextStep: "Check your Gmail connection and retry.",
        retryable: true,
      }),
    );
  }
}
/** Authenticated app-facing OAuth controls; Google credentials never cross this contract. */
export function createGmailApi(principal: Principal | null) {
  const handlers: Handlers<typeof gmailContract, GmailApiContext, Principal> = {
    gmailStatus: ({ context, principal }) =>
      principal ? invoke(() => context.gmailStatus(principal.userId)) : err(unauthorized()),
    beginGmail: ({ context, principal }) =>
      principal ? invoke(() => context.beginGmail(principal.userId)) : err(unauthorized()),
    completeGmail: ({ context, principal, body }) =>
      principal ? invoke(() => context.completeGmail(principal.userId, body)) : err(unauthorized()),
    importGmail: ({ context, principal, body }) =>
      principal ? invoke(() => context.importGmail(principal.userId, body)) : err(unauthorized()),
    disconnectGmail: ({ context, principal }) =>
      principal ? invoke(() => context.disconnectGmail(principal.userId)) : err(unauthorized()),
  };
  const policy = definePolicy<typeof gmailContract, Principal>(gmailContract, {
    verify: () => (principal ? ok(principal) : err(unauthorized())),
    operations: {
      gmailStatus: () => ok(undefined),
      beginGmail: () => ok(undefined),
      completeGmail: () => ok(undefined),
      importGmail: () => ok(undefined),
      disconnectGmail: () => ok(undefined),
    },
    disclosure: () => "public",
  });
  return serve(gmailContract, handlers, { origin: "yatma-gmail", policy });
}
