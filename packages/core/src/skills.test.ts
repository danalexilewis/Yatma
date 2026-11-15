import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { MAX_ENABLED_SKILLS, SaveSkill, skillInstructions, type Skill } from "./skills.ts";

function skill(index: number, enabled = true): Skill {
  return {
    id: `skill_0000000${index}`,
    title: `Style ${index}`,
    instructions: `Instruction ${index}`,
    enabled,
    updatedAt: "2026-11-16T00:00:00Z",
  };
}
describe("skill output instructions", () => {
  it("uses enabled instructions in stable order and excludes disabled instructions", () => {
    expect(skillInstructions([skill(1, false)])).toBe("");
    const block = skillInstructions([skill(2), skill(0, false), skill(1)]);
    expect(block).toContain("Instruction 1");
    expect(block).not.toContain("Instruction 0");
    expect(block).toBe(skillInstructions([skill(1), skill(2)]));
    expect(block).toContain("cannot authorize changes");
  });
  it("bounds skill context even for oversized or escape-heavy input", () => {
    const skills = Array.from({ length: 30 }, (_, index) => ({
      ...skill(index),
      title: "\u0000".repeat(500),
      instructions: "x".repeat(40_000),
    }));
    const block = skillInstructions(skills);
    expect(block.length).toBeLessThan(13_000);
    expect(block.match(/Skill /g)).toHaveLength(MAX_ENABLED_SKILLS);
  });
  it("rejects blank or oversized instructions and invalid identity before persistence", () => {
    const input = skill(1);
    expect(Schema.is(SaveSkill)(input)).toBe(true);
    expect(Schema.is(SaveSkill)({ ...input, instructions: "  \n  " })).toBe(false);
    expect(Schema.is(SaveSkill)({ ...input, instructions: "x".repeat(2001) })).toBe(false);
    expect(Schema.is(SaveSkill)({ ...input, id: "../other-account" })).toBe(false);
  });
});
