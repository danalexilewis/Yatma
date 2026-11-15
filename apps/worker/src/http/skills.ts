import { railError } from "@eddy-works/never-rest";
import { definePolicy } from "@eddy-works/never-rest/policy";
import { serve, type Handlers } from "@eddy-works/never-rest/server";
import { skillsContract } from "@yatma/contracts/skills";
import { InvalidRequest, type SaveSkill, type SkillList } from "@yatma/core";
import { err, ok } from "neverthrow";

type Principal = { readonly userId: string };
export interface SkillsApiContext {
  readonly listSkills: (userId: string) => Promise<SkillList>;
  readonly saveSkill: (userId: string, input: SaveSkill) => Promise<SkillList>;
  readonly deleteSkill: (userId: string, id: string) => Promise<SkillList>;
}
function unauthorized() {
  return railError("unauthorized", "Sign in to manage skills.", {
    origin: "yatma-skills",
    nextStep: "Sign in and retry.",
  });
}
async function invoke(operation: () => Promise<SkillList>) {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(
      railError("service_unavailable", "Skills could not be loaded or saved.", {
        origin: "yatma-skills",
        nextStep: "Reconnect and retry.",
        retryable: true,
      }),
    );
  }
}
async function invokeSave(operation: () => Promise<SkillList>) {
  try {
    return ok(await operation());
  } catch (cause) {
    if (cause instanceof InvalidRequest)
      return err(
        railError("invalid_request", cause.message, {
          origin: "yatma-skills",
          nextStep: "Disable or remove a skill, then retry.",
        }),
      );
    return invoke(() => Promise.reject(cause));
  }
}
/** The host-verified principal is the only source of account identity. */
export function createSkillsApi(principal: Principal | null) {
  const handlers: Handlers<typeof skillsContract, SkillsApiContext, Principal> = {
    listSkills: ({ context, principal }) =>
      principal ? invoke(() => context.listSkills(principal.userId)) : err(unauthorized()),
    saveSkill: ({ context, principal, body }) =>
      principal ? invokeSave(() => context.saveSkill(principal.userId, body)) : err(unauthorized()),
    deleteSkill: ({ context, principal, params }) =>
      principal
        ? invoke(() => context.deleteSkill(principal.userId, params.id))
        : err(unauthorized()),
  };
  const policy = definePolicy<typeof skillsContract, Principal>(skillsContract, {
    verify: () => (principal ? ok(principal) : err(unauthorized())),
    operations: {
      listSkills: () => ok(undefined),
      saveSkill: () => ok(undefined),
      deleteSkill: () => ok(undefined),
    },
    disclosure: () => "public",
  });
  return serve(skillsContract, handlers, { origin: "yatma-skills", policy });
}
