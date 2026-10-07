import type { Event } from "@yatma/core";
import { DeviceId, EventId, TaskId } from "@yatma/core";
import { describe, expect, it } from "vite-plus/test";

import { isOutboxEmpty, isOutboxEvent, selectOutboxEvents } from "./outbox";

const deviceId = DeviceId.make("device-1");
const user = { kind: "user" as const, deviceId };

function eventId(n: number): EventId {
  return EventId.make(n.toString(32).toUpperCase().replaceAll(/[ILOU]/g, "V").padStart(26, "0"));
}

function taskCreated(id: number, at: string, seq?: number): Event {
  return {
    v: 1,
    id: eventId(id),
    at,
    by: user,
    type: "task.created",
    taskId: TaskId.make("t_AAAAAAA1"),
    projectId: null,
    title: "Task",
    status: "todo",
    quadrant: null,
    position: "n",
    ...(seq === undefined ? {} : { seq }),
  };
}

describe("outbox helpers", () => {
  it("treats missing seq as outbox", () => {
    expect(isOutboxEvent(taskCreated(1, "2026-10-06T00:00:00.000Z"))).toBe(true);
    expect(isOutboxEvent(taskCreated(2, "2026-10-06T00:00:00.000Z", 3))).toBe(false);
  });

  it("selects and sorts outbox events by at then id", () => {
    const events = [
      taskCreated(2, "2026-10-06T02:00:00.000Z"),
      taskCreated(1, "2026-10-06T01:00:00.000Z", 1),
      taskCreated(3, "2026-10-06T01:30:00.000Z"),
    ];
    const outbox = selectOutboxEvents(events);
    expect(outbox.map((event) => event.id)).toEqual([eventId(3), eventId(2)]);
  });

  it("reports empty outbox when every event has seq", () => {
    expect(isOutboxEmpty([taskCreated(1, "2026-10-06T00:00:00.000Z", 1)])).toBe(true);
    expect(isOutboxEmpty([taskCreated(1, "2026-10-06T00:00:00.000Z")])).toBe(false);
  });
});
