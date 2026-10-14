import { railError } from "@eddy-works/never-rest";
import { createDispatcher, type LocalHandlers } from "@eddy-works/never-rest/local";
import { checkContractOutputs, createTestClient } from "@eddy-works/never-rest/testing";
import { describe, expect, it } from "@effect/vitest";
import { DeviceId, EventId, TaskId, type Event } from "@yatma/core";
import { err, ok } from "neverthrow";

import { healthContract } from "./health.ts";
import { syncContract } from "./sync.ts";

const deviceId = DeviceId.make("device_contract");
const event: Event = {
  v: 1,
  id: EventId.make("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
  at: "2026-10-14T00:00:00.000Z",
  by: { kind: "user", deviceId },
  type: "task.created",
  taskId: TaskId.make("t_ABCDEFGH"),
  projectId: null,
  title: "Contract fixture",
  status: "todo",
  quadrant: null,
  position: "n",
};

describe("never-rest contracts", () => {
  it("keeps Effect-schema outputs stable through JSON transport", async () => {
    const health = { ok: true as const, service: "yatma" as const, stage: "dev" };
    const healthResult = await checkContractOutputs(healthContract, {
      getHealth: health,
      getRoot: health,
    });
    const syncResult = await checkContractOutputs(syncContract, {
      pushEvents: { accepted: [event.id], assigned: [{ id: event.id, seq: 42 }] },
    });
    expect(healthResult.isOk()).toBe(true);
    expect(syncResult.isOk()).toBe(true);
  });

  it("rejects invalid input before a local handler can mutate storage", async () => {
    let calls = 0;
    const handlers: LocalHandlers<typeof syncContract, undefined> = {
      pushEvents: () => {
        calls += 1;
        return ok({ accepted: [], assigned: [] });
      },
    };
    const dispatcher = createDispatcher(syncContract, handlers, { origin: "yatma-sync" });
    const result = await dispatcher.dispatch("pushEvents", {
      body: { events: [{ ...event, title: "x".repeat(201) }], deviceId },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("validation_error");
    expect(calls).toBe(0);
  });

  it("preserves a declared failure and advice through HTTP with public disclosure", async () => {
    const handlers: LocalHandlers<typeof syncContract, undefined> = {
      pushEvents: () =>
        err(
          railError("clock_skew", "The device clock is too far ahead.", {
            origin: "yatma-sync",
            retryable: false,
            nextStep: "Correct your device clock, then retry.",
            ctx: { deviceId },
          }),
        ),
    };
    const client = createTestClient<typeof syncContract, undefined>(syncContract, handlers, {
      disclosure: "public",
    });
    const result = await client.pushEvents({ body: { events: [event], deviceId } });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe("clock_skew");
      expect(result.error.nextStep).toBe("Correct your device clock, then retry.");
      expect(result.error.retryable).toBe(false);
      expect(result.error.ctx).toBeUndefined();
    }
  });
});
