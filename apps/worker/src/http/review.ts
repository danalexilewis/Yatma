import { railError } from "@eddy-works/never-rest";
import { definePolicy } from "@eddy-works/never-rest/policy";
import { serve, type Handlers } from "@eddy-works/never-rest/server";
import { reviewContract, type ReviewSchedule } from "@yatma/contracts/review";
import { err, ok } from "neverthrow";

type Principal = { readonly userId: string };
export interface ReviewApiContext {
  readonly readReviewSchedule: (userId: string) => Promise<ReviewSchedule>;
  readonly saveReviewSchedule: (userId: string, input: ReviewSchedule) => Promise<ReviewSchedule>;
}
function unauthorized() {
  return railError("unauthorized", "Sign in to configure reviews.", {
    origin: "yatma-review",
    nextStep: "Sign in and retry.",
  });
}
async function invoke<A>(run: () => Promise<A>) {
  try {
    return ok(await run());
  } catch {
    return err(
      railError("service_unavailable", "The review schedule could not be saved or read.", {
        origin: "yatma-review",
        nextStep: "Retry when connected.",
        retryable: true,
      }),
    );
  }
}
export function createReviewApi(principal: Principal | null) {
  const handlers: Handlers<typeof reviewContract, ReviewApiContext, Principal> = {
    readReviewSchedule: ({ context, principal }) =>
      principal ? invoke(() => context.readReviewSchedule(principal.userId)) : err(unauthorized()),
    saveReviewSchedule: ({ context, principal, body }) =>
      principal
        ? invoke(() => context.saveReviewSchedule(principal.userId, body))
        : err(unauthorized()),
  };
  const policy = definePolicy<typeof reviewContract, Principal>(reviewContract, {
    verify: () => (principal ? ok(principal) : err(unauthorized())),
    operations: {
      readReviewSchedule: () => ok(undefined),
      saveReviewSchedule: () => ok(undefined),
    },
    disclosure: () => "public",
  });
  return serve(reviewContract, handlers, { origin: "yatma-review", policy });
}
