import { ChatId, DeviceId, EventId, TaskId, type SyncPushInput } from "@yatma/core";
import { describe, expect, it } from "@effect/vitest";

import { createUserApi, type UserApiContext } from "./user.ts";

function makeContext(calls: string[]): UserApiContext {
  return {
    pushEvents: async (userId, input) => {
      calls.push(`push:${userId}:${input.events.length}`);
      return { accepted: [], assigned: [] };
    },
    startTurn: async (userId, input) => {
      calls.push(`start:${userId}:${input.requestId}`);
      return { turnId: "turn_1", chatId: ChatId.make("c_ABCDEFGH"), batchId: "batch_1", status: "running" };
    },
    getTurn: async (userId, turnId) => {
      calls.push(`get:${userId}:${turnId}`);
      return {
        receipt: { turnId, chatId: ChatId.make("c_ABCDEFGH"), batchId: "batch_1", status: "completed" },
        resultText: "Done",
        batches: [],
        error: null,
      };
    },
    stopTurn: async (userId, input) => {
      calls.push(`stop:${userId}:${input.turnId}`);
      return { ok: true };
    },
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("authenticated user HTTP contracts", () => {
  it("dispatches sync and turn controls only for the host-verified principal", async () => {
    const calls: string[] = [];
    const api = createUserApi({ userId: "user_123" });
    const context = makeContext(calls);
    const syncInput: SyncPushInput = { events: [], deviceId: DeviceId.make("device_api") };

    const push = await api(new Request("https://yatma.test/api/sync/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(syncInput),
    }), context);
    const start = await api(new Request("https://yatma.test/api/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req_1", messageId: "msg_1", projectId: null, text: "Hi", events: [] }),
    }), context);
    const get = await api(new Request("https://yatma.test/api/turns/turn_1"), context);
    const stop = await api(new Request("https://yatma.test/api/turns/turn_1/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: "turn_1" }),
    }), context);

    expect(push.status).toBe(200);
    expect(start.status).toBe(200);
    expect(get.status).toBe(200);
    expect(stop.status).toBe(200);
    expect(calls).toEqual([
      "push:user_123:0",
      "start:user_123:req_1",
      "get:user_123:turn_1",
      "stop:user_123:turn_1",
    ]);
  });

  it("rejects invalid and unauthenticated requests before calling the DO", async () => {
    const calls: string[] = [];
    const context = makeContext(calls);
    const invalidEvent = {
      v: 1,
      id: EventId.make("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
      at: "2026-10-15T00:00:00.000Z",
      by: { kind: "user", deviceId: DeviceId.make("device_api") },
      type: "task.created",
      taskId: TaskId.make("t_ABCDEFGH"),
      projectId: null,
      title: "x".repeat(201),
      status: "todo",
      quadrant: null,
      position: "p1",
    };
    const invalid = await createUserApi({ userId: "user_123" })(new Request("https://yatma.test/api/sync/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [invalidEvent], deviceId: DeviceId.make("device_api") }),
    }), context);
    const unauthorized = await createUserApi(null)(new Request("https://yatma.test/api/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req_2", messageId: "msg_2", projectId: null, text: "Hi", events: [] }),
    }), context);

    expect(invalid.status).toBe(400);
    expect((await readJson(invalid)).code).toBe("validation_error");
    expect(unauthorized.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
