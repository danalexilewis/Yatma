import { railError } from "@eddy-works/never-rest";
import { definePolicy } from "@eddy-works/never-rest/policy";
import { serve, type Handlers } from "@eddy-works/never-rest/server";
import { modelSettingsContract } from "@yatma/contracts/modelSettings";
import type { ModelSettings, SaveModelSettings } from "@yatma/core";
import { err, ok } from "neverthrow";

type Principal = { readonly userId: string };
export interface ModelSettingsApiContext {
  readonly getModelSettings: (userId: string) => Promise<ModelSettings>;
  readonly saveModelSettings: (userId: string, input: SaveModelSettings) => Promise<ModelSettings>;
  readonly removeModelSettings: (userId: string) => Promise<ModelSettings>;
}
function unauthorized() {
  return railError("unauthorized", "Sign in to configure AI chat.", {
    origin: "yatma-model-settings",
    nextStep: "Sign in and retry.",
  });
}
async function invoke<A>(operation: () => Promise<A>) {
  try {
    return ok(await operation());
  } catch {
    return err(
      railError("service_unavailable", "AI settings could not be updated or read.", {
        origin: "yatma-model-settings",
        nextStep:
          "Reconnect and retry. If saving remains unavailable, check the Worker's key-storage configuration.",
        retryable: true,
      }),
    );
  }
}
/** Only the host-verified principal selects the account; errors never echo credentials. */
export function createModelSettingsApi(principal: Principal | null) {
  const handlers: Handlers<typeof modelSettingsContract, ModelSettingsApiContext, Principal> = {
    getModelSettings: ({ context, principal }) =>
      principal ? invoke(() => context.getModelSettings(principal.userId)) : err(unauthorized()),
    saveModelSettings: ({ context, principal, body }) =>
      principal
        ? invoke(() => context.saveModelSettings(principal.userId, body))
        : err(unauthorized()),
    removeModelSettings: ({ context, principal }) =>
      principal ? invoke(() => context.removeModelSettings(principal.userId)) : err(unauthorized()),
  };
  const policy = definePolicy<typeof modelSettingsContract, Principal>(modelSettingsContract, {
    verify: () => (principal ? ok(principal) : err(unauthorized())),
    operations: {
      getModelSettings: () => ok(undefined),
      saveModelSettings: () => ok(undefined),
      removeModelSettings: () => ok(undefined),
    },
    disclosure: () => "public",
  });
  return serve(modelSettingsContract, handlers, { origin: "yatma-model-settings", policy });
}
