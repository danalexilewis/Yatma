import { serve, type Handlers } from "@eddy-works/never-rest/server";
import { healthContract } from "@yatma/contracts/health";
import { ok } from "neverthrow";

/** Mount the public health contract; authenticated user operations are composed separately. */
export function createHealthApi(stage: string) {
  function getHealth() {
    return ok({ ok: true as const, service: "yatma" as const, stage });
  }

  const handlers: Handlers<typeof healthContract, undefined> = {
    getHealth,
    getRoot: getHealth,
  };

  return serve(healthContract, handlers, {
    origin: "yatma-health",
    disclosure: "public",
  });
}
