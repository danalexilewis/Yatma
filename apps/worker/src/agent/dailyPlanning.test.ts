import { describe, expect, it } from "@effect/vitest";
import {
  BatchId,
  ChatId,
  DeviceId,
  PlanDayTool,
  ProjectId,
  ReadDayTool,
  TaskId,
  assistantMessageId,
  stackDayId,
  taskDayEntryId,
} from "@yatma/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as EventStore from "../eventStore.ts";
import {
  makeCommitHub,
  makeMutationService,
  type MutationService,
} from "../application/mutations.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import * as ModelGateway from "./modelGateway.ts";
import * as Usage from "./usage.ts";
import * as Tools from "./tools.ts";
import { planningContextForTurn } from "./dailyPlanning.ts";
import { runAgentTurn } from "./turn.ts";

const DEVICE = { kind: "user" as const, deviceId: DeviceId.make("device-planning") };
const CHAT = ChatId.make("c_P1AN0001");
const PROJECT = ProjectId.make("p_P1AN0001");
const A = TaskId.make("t_P1AN0001");
const B = TaskId.make("t_P1AN0002");
const PLANNING = { date: "2026-11-11", timezone: "Pacific/Auckland" };
const NOW = "2026-11-11T00:00:00.000Z";
const AGENT = { kind: "agent" as const, chatId: CHAT, model: "scripted" };

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  EventStore.migrate.pipe(
    Effect.andThen(Usage.migrate),
    Effect.andThen(effect),
    Effect.provide(NodeSqlite.layer({ filename: ":memory:" })),
  );

const seed = Effect.fn("DailyPlanningTest.seed")(function* () {
  const mutations = makeMutationService(yield* makeCommitHub);
  yield* mutations.executeBatch({
    actor: DEVICE,
    now: NOW,
    commands: [
      { type: "project.create", projectId: PROJECT, input: { title: "Website" } },
      { type: "task.create", taskId: A, input: { title: "Review homepage", projectId: PROJECT } },
      {
        type: "task.create",
        taskId: B,
        input: { title: "Deferred candidate", projectId: PROJECT },
      },
    ],
  });
  return mutations;
});
function ctx(mutations: MutationService) {
  return { actor: AGENT, batchId: Tools.newBatchId(), nowIso: NOW, mutations };
}
function call(id: string, name: string, args: object) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}

describe("agent daily planning tools", () => {
  it.effect("reads an unprepared day without selecting backlog or writing events", () =>
    withStore(
      Effect.gen(function* () {
        yield* seed();
        const before = (yield* EventStore.loadAllEvents).length;
        const result = yield* Tools.readDay(PLANNING);
        expect(Tools.isToolFailure(result)).toBe(false);
        if (Tools.isToolFailure(result)) return;
        expect(Schema.is(ReadDayTool.successSchema)(result)).toBe(true);
        expect(result.day).toBeNull();
        expect(result.entries).toEqual([]);
        expect((yield* EventStore.loadAllEvents).length).toBe(before);
      }),
    ),
  );

  it.effect(
    "selects only requested tasks and activities through the serialized writer with audited reason",
    () =>
      withStore(
        Effect.gen(function* () {
          const mutations = yield* seed();
          const result = yield* Tools.planDay(
            {
              ...PLANNING,
              reason: "User chose homepage review and a short break",
              ops: [
                { op: "add_task", taskId: A, allocationMinutes: 20 },
                { op: "add_activity", kind: "break", title: "Short break", allocationMinutes: 5 },
              ],
            },
            ctx(mutations),
          );
          expect(Tools.isToolFailure(result)).toBe(false);
          if (Tools.isToolFailure(result)) return;
          expect(Schema.is(PlanDayTool.successSchema)(result)).toBe(true);
          expect(
            result.events.every(
              (event) =>
                event.reason === "User chose homepage review and a short break" &&
                event.by.kind === "agent",
            ),
          ).toBe(true);
          const folded = yield* EventStore.loadFolded;
          const dayId = stackDayId(PLANNING.date, PLANNING.timezone);
          expect(folded.dayEntries.get(taskDayEntryId(dayId, A))?.allocationMinutes).toBe(20);
          expect(folded.dayEntries.has(taskDayEntryId(dayId, B))).toBe(false);
          expect(
            [...folded.dayEntries.values()].find((entry) => entry.kind === "break")?.title,
          ).toBe("Short break");
          expect(folded.workIntervals.size).toBe(0);
          expect(folded.tasks.get(A)?.status).toBe("todo");
        }),
      ),
  );

  it.effect(
    "updates, moves and removes selected entries without changing backlog task identity",
    () =>
      withStore(
        Effect.gen(function* () {
          const mutations = yield* seed();
          const taskBefore = (yield* EventStore.loadFolded).tasks.get(A);
          const created = yield* Tools.planDay(
            {
              ...PLANNING,
              reason: "User selected work and preparation",
              ops: [
                { op: "add_task", taskId: A, allocationMinutes: 20 },
                {
                  op: "add_activity",
                  kind: "activity",
                  title: "Prepare desk",
                  allocationMinutes: 5,
                },
              ],
            },
            ctx(mutations),
          );
          if (Tools.isToolFailure(created)) throw new Error(created.message);
          const activity = created.events.find(
            (event) => event.type === "dayEntry.created" && event.entry.kind === "activity",
          );
          if (activity?.type !== "dayEntry.created") throw new Error("Missing committed activity");
          const taskEntryId = taskDayEntryId(stackDayId(PLANNING.date, PLANNING.timezone), A);
          const changed = yield* Tools.planDay(
            {
              ...PLANNING,
              reason: "User moved preparation first and reduced it",
              ops: [
                {
                  op: "update_entry",
                  entryId: activity.entry.id,
                  title: "Prepare workspace",
                  allocationMinutes: 3,
                },
                { op: "move_entry", entryId: activity.entry.id, beforeEntryId: taskEntryId },
              ],
            },
            ctx(mutations),
          );
          expect(Tools.isToolFailure(changed)).toBe(false);
          const read = yield* Tools.readDay(PLANNING);
          if (Tools.isToolFailure(read)) throw new Error(read.message);
          expect(read.entries[0]).toMatchObject({
            id: activity.entry.id,
            title: "Prepare workspace",
            allocationMinutes: 3,
          });
          const removed = yield* Tools.planDay(
            {
              ...PLANNING,
              reason: "User removed today's work commitment",
              ops: [{ op: "remove_entry", entryId: taskEntryId }],
            },
            ctx(mutations),
          );
          expect(Tools.isToolFailure(removed)).toBe(false);
          const folded = yield* EventStore.loadFolded;
          expect(folded.dayEntries.get(taskEntryId)?.status).toBe("removed");
          expect(folded.tasks.get(A)).toMatchObject({
            ...taskBefore,
            scheduledDate: null,
            updatedAt: folded.tasks.get(A)!.updatedAt,
            lastReason: "User removed today's work commitment",
          });
          expect(folded.workIntervals.size).toBe(0);
        }),
      ),
  );

  it.effect("rejects invalid schemas and missing writers without effects", () =>
    withStore(
      Effect.gen(function* () {
        const mutations = yield* seed();
        const before = (yield* EventStore.loadAllEvents).length;
        const invalid = yield* Tools.planDay(
          {
            ...PLANNING,
            reason: "Choose work",
            ops: [{ op: "add_task", taskId: A, allocationMinutes: -1 }],
          },
          ctx(mutations),
        );
        expect(Tools.isToolFailure(invalid)).toBe(true);
        const invalidTimezone = yield* Tools.readDay({ ...PLANNING, timezone: "Invalid/Timezone" });
        expect(Tools.isToolFailure(invalidTimezone)).toBe(true);
        const missingWriter = yield* Tools.planDay(
          { ...PLANNING, reason: "Choose work", ops: [{ op: "add_task", taskId: A }] },
          { actor: AGENT, batchId: Tools.newBatchId(), nowIso: NOW },
        );
        expect(Tools.isToolFailure(missingWriter)).toBe(true);
        expect((yield* EventStore.loadAllEvents).length).toBe(before);
      }),
    ),
  );

  it.effect(
    "rejects foreign entry and move targets atomically before applying any requested additions",
    () =>
      withStore(
        Effect.gen(function* () {
          const mutations = yield* seed();
          yield* Tools.planDay(
            { ...PLANNING, reason: "Choose review", ops: [{ op: "add_task", taskId: A }] },
            ctx(mutations),
          );
          const dayId = stackDayId(PLANNING.date, PLANNING.timezone);
          const foreignEntry = taskDayEntryId(dayId, A);
          const before = (yield* EventStore.loadAllEvents).length;
          const rejected = yield* Tools.planDay(
            {
              date: "2026-11-12",
              timezone: PLANNING.timezone,
              reason: "Mistaken target",
              ops: [
                { op: "add_task", taskId: B },
                { op: "remove_entry", entryId: foreignEntry },
              ],
            },
            ctx(mutations),
          );
          expect(Tools.isToolFailure(rejected)).toBe(true);
          const secondDayId = stackDayId("2026-11-12", PLANNING.timezone);
          const rejectedMove = yield* Tools.planDay(
            {
              date: "2026-11-12",
              timezone: PLANNING.timezone,
              reason: "Mistaken move target",
              ops: [
                { op: "add_task", taskId: B },
                {
                  op: "move_entry",
                  entryId: taskDayEntryId(secondDayId, B),
                  beforeEntryId: foreignEntry,
                },
              ],
            },
            ctx(mutations),
          );
          expect(Tools.isToolFailure(rejectedMove)).toBe(true);
          expect((yield* EventStore.loadAllEvents).length).toBe(before);
          expect((yield* EventStore.loadFolded).days.has(secondDayId)).toBe(false);
        }),
      ),
  );

  it.effect("leaves no partial day when a later command fails domain validation", () =>
    withStore(
      Effect.gen(function* () {
        const mutations = yield* seed();
        const before = (yield* EventStore.loadAllEvents).length;
        const result = yield* Tools.planDay(
          {
            ...PLANNING,
            reason: "Chosen items",
            ops: [
              { op: "add_task", taskId: A },
              { op: "add_task", taskId: TaskId.make("t_M1SS0001") },
            ],
          },
          ctx(mutations),
        );
        expect(Tools.isToolFailure(result)).toBe(true);
        expect((yield* EventStore.loadAllEvents).length).toBe(before);
        expect((yield* EventStore.loadFolded).dayEntries.size).toBe(0);
      }),
    ),
  );

  it.effect("reads project properties and live tasks through the shared read tool", () =>
    withStore(
      Effect.gen(function* () {
        yield* seed();
        const result = yield* Tools.read({ kind: "project", projectId: PROJECT });
        expect(Tools.isToolFailure(result)).toBe(false);
        if (Tools.isToolFailure(result) || result.kind !== "project") return;
        expect(result.project.title).toBe("Website");
        expect(result.tasks.map((task) => task.id)).toEqual([A, B]);
      }),
    ),
  );

  it.effect(
    "prefers the explicit device planning day and never invents a timezone for legacy empty state",
    () =>
      withStore(
        Effect.gen(function* () {
          yield* seed();
          const folded = yield* EventStore.loadFolded;
          expect(
            planningContextForTurn(folded, PLANNING, "2026-11-10T23:30:00.000Z"),
          ).toMatchObject(PLANNING);
          expect(
            planningContextForTurn(folded, undefined, "2026-11-10T23:30:00.000Z"),
          ).toMatchObject({ date: "2026-11-10", timezone: null });
        }),
      ),
  );
});

describe("daily planning through runAgentTurn", () => {
  it.effect("executes a scripted read → chosen plan → durable reply flow", () =>
    withStore(
      Effect.gen(function* () {
        const mutations = yield* seed();
        const gateway = ModelGateway.makeScriptedGateway([
          {
            text: "",
            tokens: 3,
            toolCalls: [
              call("read-day", "read_day", PLANNING),
              call("list", "list_tasks", {}),
              call("read-project", "read", { kind: "project", projectId: PROJECT }),
            ],
          },
          {
            text: "",
            tokens: 3,
            toolCalls: [
              call("choose", "plan_day", {
                ...PLANNING,
                reason: "User explicitly selected homepage review",
                ops: [{ op: "add_task", taskId: A, allocationMinutes: 20 }],
              }),
            ],
          },
          {
            text: "Selected [Review homepage](task:t_P1AN0001) for 20 minutes.",
            tokens: 3,
            toolCalls: [],
          },
        ]);
        const items = yield* Stream.runCollect(
          runAgentTurn({
            chatId: CHAT,
            projectId: null,
            text: "Add homepage review to today for 20 minutes",
            planning: PLANNING,
            turnId: "planning-flow",
            model: "scripted",
            openRouterKey: "scripted",
            signal: new AbortController().signal,
            mutations,
            gateway,
          }),
        );
        expect(
          items.filter((item) => item.kind === "tool_started").map((item) => item.tool),
        ).toEqual(["read_day", "list_tasks", "read", "plan_day"]);
        expect(
          items.some(
            (item) =>
              item.kind === "changes" &&
              item.events.some((event) => event.type === "dayEntry.created"),
          ),
        ).toBe(true);
        expect(gateway.remaining()).toBe(0);
        const folded = yield* EventStore.loadFolded;
        const dayId = stackDayId(PLANNING.date, PLANNING.timezone);
        expect(folded.dayEntries.get(taskDayEntryId(dayId, A))?.allocationMinutes).toBe(20);
        expect(folded.dayEntries.has(taskDayEntryId(dayId, B))).toBe(false);
        expect(
          folded.chats
            .get(CHAT)
            ?.messages.some(
              (message) =>
                message.id === assistantMessageId("planning-flow") &&
                message.text.includes("20 minutes"),
            ),
        ).toBe(true);
      }),
    ),
  );

  it.effect(
    "keeps a suggestions-only check-in read-only and rejects unsupported model planning ops",
    () =>
      withStore(
        Effect.gen(function* () {
          const mutations = yield* seed();
          const gateway = ModelGateway.makeScriptedGateway([
            {
              text: "",
              tokens: 1,
              toolCalls: [call("read-day", "read_day", PLANNING), call("list", "list_tasks", {})],
            },
            {
              text: "Would a 20-minute homepage review fit your morning?",
              tokens: 1,
              toolCalls: [],
            },
          ]);
          yield* Stream.runDrain(
            runAgentTurn({
              chatId: CHAT,
              projectId: null,
              text: "Help me decide what to do today",
              planning: PLANNING,
              turnId: "suggest-only",
              model: "scripted",
              openRouterKey: "scripted",
              signal: new AbortController().signal,
              mutations,
              gateway,
            }),
          );
          expect((yield* EventStore.loadFolded).dayEntries.size).toBe(0);
          const invalidGateway = ModelGateway.makeScriptedGateway([
            {
              text: "",
              tokens: 1,
              toolCalls: [
                call("invalid", "plan_day", {
                  ...PLANNING,
                  reason: "Invalid proposed control",
                  ops: [{ op: "start_timer", taskId: A }],
                }),
              ],
            },
            { text: "The plan has not changed.", tokens: 1, toolCalls: [] },
          ]);
          const items = yield* Stream.runCollect(
            runAgentTurn({
              chatId: CHAT,
              projectId: null,
              text: "Show an option",
              planning: PLANNING,
              turnId: "invalid-plan-op",
              model: "scripted",
              openRouterKey: "scripted",
              signal: new AbortController().signal,
              mutations,
              gateway: invalidGateway,
            }),
          );
          expect(items.some((item) => item.kind === "changes")).toBe(false);
          const folded = yield* EventStore.loadFolded;
          expect(folded.dayEntries.size).toBe(0);
          expect(folded.workIntervals.size).toBe(0);
          expect(folded.tasks.get(A)?.status).toBe("todo");
        }),
      ),
  );
});
