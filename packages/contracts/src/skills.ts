import type { ContractDef } from "@eddy-works/never-rest/contract";
import { SaveSkill, SkillIdentity, SkillList } from "@yatma/core";
import * as Schema from "effect/Schema";

export { SaveSkill, SkillIdentity, SkillList, Skill } from "@yatma/core";

/** Account-owned output instructions, shared by the mobile client and Worker host. */
export const skillsContract = {
  listSkills: {
    method: "GET",
    path: "/api/skills",
    output: Schema.toStandardSchemaV1(SkillList),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
  saveSkill: {
    method: "PUT",
    path: "/api/skills",
    body: Schema.toStandardSchemaV1(SaveSkill),
    output: Schema.toStandardSchemaV1(SkillList),
    errors: { unauthorized: 401, invalid_request: 422, service_unavailable: 503 },
  },
  deleteSkill: {
    method: "DELETE",
    path: "/api/skills/:id",
    params: Schema.toStandardSchemaV1(SkillIdentity),
    output: Schema.toStandardSchemaV1(SkillList),
    errors: { unauthorized: 401, service_unavailable: 503 },
  },
} as const satisfies ContractDef;
