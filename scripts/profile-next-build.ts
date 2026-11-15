import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import {
  CROCKFORD_BASE32,
  ChatId,
  DeviceId,
  EventId,
  TaskId,
  foldEvents,
  pageThreadMessages,
  parseEventLine,
  selectThreadMessages,
  type Event,
} from "../packages/core/src/index.ts";
import { entityRowsFromFolded } from "../apps/mobile/src/db/entities.ts";
import { SCHEMA_SQL } from "../apps/mobile/src/db/schema.ts";
import { flattenThreadMessages } from "../apps/mobile/src/features/chat/messageParts.ts";

/** Local CPU/Node SQLite measurements; this does not benchmark Expo VFS or native rendering. */
function createJournal(messageCount: number): Event[] {
  const actor = { kind: "user" as const, deviceId: DeviceId.make("profile-device") };
  const chatId = ChatId.make("c_00000001");
  const events: Event[] = [];
  let id = 0;
  function envelope(at: string) {
    return { v: 1 as const, by: actor, at, id: EventId.make(String(++id).padStart(26, "0")) };
  }
  function taskId(index: number) {
    let value = index;
    let encoded = "";
    do {
      encoded = CROCKFORD_BASE32[value % 32]! + encoded;
      value = Math.floor(value / 32);
    } while (value);
    return TaskId.make(`t_${encoded.padStart(8, "0")}`);
  }
  const start = "2026-09-01T00:00:00.000Z";
  events.push({
    ...envelope(start),
    type: "chat.created",
    chatId,
    projectId: null,
    title: "Profile thread",
  });
  for (let index = 0; index < 100; index += 1) {
    events.push({
      ...envelope(start),
      type: "task.created",
      taskId: taskId(index),
      projectId: null,
      title: `Task ${index}`,
      notes: "Representative task context",
      status: "todo",
      quadrant: null,
      position: String(index).padStart(4, "0"),
    });
  }
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const at = `${date}T08:00:00.000Z`;
    const dayId = JSON.stringify([date, "Pacific/Auckland"]);
    events.push({
      ...envelope(at),
      type: "day.created",
      day: {
        id: dayId,
        date,
        timezone: "Pacific/Auckland",
        assembled: true,
        suppressedBreakOrigins: [],
        createdAt: at,
        updatedAt: at,
      },
    });
    for (let entry = 0; entry < 10; entry += 1) {
      const entryId = JSON.stringify([dayId, taskId(entry)]);
      events.push({
        ...envelope(at),
        type: "dayEntry.created",
        entry: {
          id: entryId,
          dayId,
          kind: "task",
          taskId: taskId(entry),
          title: `Task ${entry}`,
          allocationMinutes: 30,
          position: String(entry).padStart(4, "0"),
          status: "pending",
          origin: "backlog",
          manual: false,
          carryOrder: null,
          preparation: false,
          resumeEntryId: null,
          createdAt: at,
          updatedAt: at,
        },
      });
      for (let run = 0; run < 2; run += 1) {
        const startedAt = `${date}T${String(8 + entry).padStart(2, "0")}:${String(run * 20).padStart(2, "0")}:00.000Z`;
        const endedAt = new Date(Date.parse(startedAt) + 10 * 60 * 1000).toISOString();
        events.push({
          ...envelope(endedAt),
          type: "workInterval.created",
          interval: {
            id: `${entryId}:${run}`,
            entryId,
            dayId,
            deviceId: actor.deviceId,
            startedAt,
            endedAt,
            correctedSeconds: null,
            updatedAt: endedAt,
          },
        });
      }
    }
  }
  for (let index = 0; index < messageCount; index += 1) {
    const at = new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 60_000).toISOString();
    const text =
      index === messageCount - 1
        ? Array.from(
            { length: 200 },
            (_, occurrence) =>
              `${occurrence + 1}. [Task ${occurrence % 100}](task:${taskId(occurrence % 100)}) — Keep this historical commentary.`,
          ).join("\n")
        : `Message ${index}: historical commentary with [Task ${index % 100}](task:${taskId(index % 100)}).`;
    events.push({
      ...envelope(at),
      type: "chat.message",
      chatId,
      messageId: `message-${index}`,
      role: index % 2 ? "assistant" : "user",
      text,
    });
  }
  return events;
}

function measure<A>(run: () => A) {
  const durations: number[] = [];
  let result!: A;
  for (let sample = 0; sample < 3; sample += 1) {
    const started = performance.now();
    result = run();
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  return { result, medianMs: Number(durations[1]!.toFixed(3)) };
}

function profile(messageCount: number) {
  const events = createJournal(messageCount);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SCHEMA_SQL);
    const insert = db.prepare(
      "INSERT INTO events (id, at, type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (const event of events)
      insert.run(event.id, event.at, event.type, JSON.stringify(event), 0);
    db.exec("COMMIT");
    const read = db.prepare("SELECT payload FROM events ORDER BY at ASC, id ASC");
    const hydration = measure(() => {
      const decoded: Event[] = [];
      for (const row of read.all()) {
        const parsed = parseEventLine(String(row.payload));
        assert.equal(parsed.ok, true, "Profile fixture must remain readable by production schemas");
        if (parsed.ok) decoded.push(parsed.event);
      }
      return decoded;
    });
    const fold = measure(() => foldEvents(hydration.result));
    const rows = entityRowsFromFolded(fold.result);
    const insertEntity = db.prepare(
      "INSERT INTO entities (kind, id, payload, updated_at) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (const row of rows) insertEntity.run(row.kind, row.id, row.payload, row.updatedAt);
    db.exec("COMMIT");
    const readCache = db.prepare("SELECT kind, id, payload FROM entities");
    const cacheDecode = measure(() =>
      readCache.all().map((row) => ({
        kind: row.kind,
        id: row.id,
        payload: JSON.parse(String(row.payload)) as unknown,
      })),
    );
    const selection = measure(() => selectThreadMessages(fold.result));
    const latest = measure(() => pageThreadMessages(selection.result, [], "latest"));
    const retained = pageThreadMessages(
      selection.result,
      pageThreadMessages(selection.result, latest.result.messages, "older").messages,
      "older",
    );
    const flatten = measure(() => flattenThreadMessages(retained.messages));
    const largeReply = flattenThreadMessages(selection.result.slice(-1));
    assert.equal(latest.result.messages.length, Math.min(50, messageCount));
    assert.equal(retained.messages.length, Math.min(150, messageCount));
    assert.equal(
      largeReply.filter((row) => row.kind === "part" && row.part.kind === "task").length,
      200,
    );
    return {
      messageCount,
      eventCount: events.length,
      journalBytes: events.reduce(
        (bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)),
        0,
      ),
      projectedEntityCount: rows.length,
      dayCount: fold.result.days.size,
      intervalCount: fold.result.workIntervals.size,
      journalReadAndSchemaDecodeMedianMs: hydration.medianMs,
      fullJournalFoldMedianMs: fold.medianMs,
      projectionReadAndJsonDecodeMedianMs: cacheDecode.medianMs,
      allMessageSelectionMedianMs: selection.medianMs,
      latestWindowMedianMs: latest.medianMs,
      flattenRetainedWindowMedianMs: flatten.medianMs,
      retainedMessages: retained.messages.length,
      retainedRows: flatten.result.length,
      retainedSerializedBytes: Buffer.byteLength(JSON.stringify(retained.messages)),
      largeReplyRows: largeReply.length,
    };
  } finally {
    db.close();
  }
}

const results = [1000, 5000].map(profile);
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      environment: `${process.platform}/${process.arch}`,
      samplesPerPhase: 3,
      caveats: [
        "In-memory Node SQLite query/schema-decode/full-fold CPU profile; not Expo SQLite/VFS, disk startup, Cloudflare, or native-render evidence.",
        "Cold hydration reads and decodes the complete journal even with cached projections; full fold is separately measured for the no-cache/write path.",
        "Presentation selection still visits every hydrated message; only the retained window and flattened rows are bounded.",
        "Three samples include JIT and allocation variability; no latency threshold or long-history performance claim is inferred.",
      ],
      results,
    },
    null,
    2,
  ),
);
