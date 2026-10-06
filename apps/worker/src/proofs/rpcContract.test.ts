// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "@effect/vitest";
import {
  DeviceId,
  EventId,
  PingResult,
  SyncPushInput,
  SyncPushResult,
  TaskId,
  type Event,
} from "@yatma/core";
import * as Schema from "effect/Schema";

const DEVICE = { kind: "user" as const, deviceId: DeviceId.make("device_contract") };

function ulid(seed: string): string {
  const base = seed.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "0");
  return (base + "00000000000000000000000000").slice(0, 26);
}

describe("rpcContract", () => {
  it("encodes and decodes ping success via core PingResult", () => {
    const value = { ok: true as const, now: "2026-10-06T00:00:00.000Z" };
    const encoded = Schema.encodeSync(PingResult)(value);
    const decoded = Schema.decodeUnknownSync(PingResult)(encoded);
    expect(decoded).toEqual(value);
  });

  it("encodes and decodes sync.push payload + result via core schemas", () => {
    const event: Event = {
      v: 1,
      type: "task.created",
      id: EventId.make(ulid("01RPCCONTRACTEVENT0000001")),
      at: "2026-10-06T00:00:00.000Z",
      by: DEVICE,
      taskId: TaskId.make("t_CNTRACT1"),
      projectId: null,
      title: "Contract check",
      status: "todo",
      quadrant: null,
      position: "n",
    };

    const pushInput = {
      events: [event],
      deviceId: DeviceId.make("device_contract"),
    };
    const encodedInput = Schema.encodeSync(SyncPushInput)(pushInput);
    const decodedInput = Schema.decodeUnknownSync(SyncPushInput)(encodedInput);
    expect(decodedInput.deviceId).toBe(pushInput.deviceId);
    expect(decodedInput.events).toHaveLength(1);
    expect(decodedInput.events[0]?.id).toBe(event.id);

    const pushResult = {
      accepted: [event.id],
      assigned: [{ id: event.id, seq: 1 }],
    };
    const encodedResult = Schema.encodeSync(SyncPushResult)(pushResult);
    const decodedResult = Schema.decodeUnknownSync(SyncPushResult)(encodedResult);
    expect(decodedResult).toEqual(pushResult);
  });
});
