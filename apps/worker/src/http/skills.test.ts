import { createClient } from "@eddy-works/never-rest/client";
import { skillsContract } from "@yatma/contracts/skills";
import { InvalidRequest } from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { createSkillsApi, type SkillsApiContext } from "./skills.ts";
const skill = {
  id: "skill_12345678",
  title: "Concise",
  instructions: "Use short bullets.",
  enabled: true,
  updatedAt: "2026-11-16T00:00:00Z",
};

describe("skills HTTP contract", () => {
  it("uses only the verified account for list, save and delete", async () => {
    const calls: string[] = [];
    const context: SkillsApiContext = {
      listSkills: async (id) => {
        calls.push(`list:${id}`);
        return { skills: [skill] };
      },
      saveSkill: async (id, input) => {
        calls.push(`save:${id}`);
        return { skills: [{ ...input, updatedAt: skill.updatedAt }] };
      },
      deleteSkill: async (id, skillId) => {
        calls.push(`delete:${id}:${skillId}`);
        return { skills: [] };
      },
    };
    const api = createSkillsApi({ userId: "verified" });
    const client = createClient(skillsContract, {
      baseUrl: "https://api.test",
      fetch: async (input, init) => {
        const result = await api.handle(new Request(input, init), context);
        if (!result.matched) throw new Error("unmatched");
        return result.response;
      },
    });
    const listed = await client.listSkills({});
    expect(listed.isOk() && listed.value.skills[0]?.instructions).toBe(skill.instructions);
    expect((await client.saveSkill({ body: skill })).isOk()).toBe(true);
    expect((await client.deleteSkill({ params: { id: skill.id } })).isOk()).toBe(true);
    expect(calls).toEqual(["list:verified", "save:verified", `delete:verified:${skill.id}`]);
  });
  it("rejects unauthenticated/invalid ingress before storage, masks defects and returns actionable limits", async () => {
    let calls = 0;
    let limit = false;
    const context: SkillsApiContext = {
      listSkills: async () => ({ skills: [] }),
      saveSkill: async () => {
        calls++;
        throw limit
          ? new InvalidRequest({
              message: "You can enable up to 5 skills at once. Disable one first.",
            })
          : new Error("private-sql-detail");
      },
      deleteSkill: async () => ({ skills: [] }),
    };
    function request(input: unknown) {
      return new Request("https://api.test/api/skills?userId=attacker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }
    const unauthorized = await createSkillsApi(null).handle(request(skill), context);
    expect(unauthorized.matched && unauthorized.response.status).toBe(401);
    const api = createSkillsApi({ userId: "verified" });
    const invalid = await api.handle(request({ ...skill, instructions: " " }), context);
    expect(invalid.matched && invalid.response.status).toBe(400);
    expect(calls).toBe(0);
    const failed = await api.handle(request(skill), context);
    expect(failed.matched && failed.response.status).toBe(503);
    expect(failed.matched && (await failed.response.text())).not.toContain("private-sql-detail");
    limit = true;
    const limited = await api.handle(request(skill), context);
    expect(limited.matched && limited.response.status).toBe(422);
    expect(limited.matched && (await limited.response.text())).toContain("Disable one first");
  });
});
