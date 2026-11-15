import { describe, expect, it } from "@effect/vitest";
import { skillInstructions, type Skill } from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as EventStore from "../eventStore.ts";
import * as Skills from "../application/skills.ts";
import * as Mutations from "../application/mutations.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as Supervisor from "./supervisor.ts";
import * as Usage from "./usage.ts";
import type { ChatMessage } from "./openrouter.ts";

const sqlLayer = NodeSqlite.layer({ filename: ":memory:" });
const skill: Skill = {
  id: "skill_12345678",
  title: "My response format",
  instructions: "Always finish with one concrete next step.",
  enabled: true,
  updatedAt: "2026-11-16T00:00:00Z",
};

it.effect(
  "resolves persisted enabled skills for each new turn and removes disabled instructions from later prompts",
  () =>
    Effect.gen(function* () {
      yield* EventStore.migrate;
      yield* Skills.migrate;
      yield* Usage.migrate;
      yield* Supervisor.migrate;
      yield* Skills.save(skill, skill.updatedAt);
      const prompts: (readonly ChatMessage[])[] = [];
      const supervisor = yield* Supervisor.makeSupervisor({
        sqlLayer,
        mutations: Mutations.makeMutationService(yield* Mutations.makeCommitHub),
        model: "scripted",
        openRouterKey: "scripted",
        resolveModel: () =>
          Skills.list.pipe(
            Effect.map(({ skills }) => ({ model: "scripted", openRouterKey: "scripted", skills })),
            Effect.provide(sqlLayer),
            Effect.orDie,
          ),
        gateway: {
          stream: (messages) => {
            prompts.push(messages);
            return Stream.make({ type: "text", text: "A reply" }, { type: "usage", tokens: 2 });
          },
        },
      });
      function start(requestId: string) {
        return supervisor.start({
          requestId,
          messageId: `message-${requestId}`,
          projectId: null,
          text: "Help me plan",
          events: [],
        });
      }
      const first = yield* start("with-skill");
      yield* Stream.runDrain(supervisor.observe(first.turnId, 0));
      expect(
        prompts[0]?.some(
          (message) => message.role === "system" && message.content === skillInstructions([skill]),
        ),
      ).toBe(true);
      yield* Skills.save({ ...skill, enabled: false }, skill.updatedAt);
      const second = yield* start("disabled-skill");
      yield* Stream.runDrain(supervisor.observe(second.turnId, 0));
      expect(
        prompts[1]?.some(
          (message) =>
            typeof message.content === "string" && message.content.includes(skill.instructions),
        ),
      ).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(sqlLayer)),
);
