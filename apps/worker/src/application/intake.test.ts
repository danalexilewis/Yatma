import { expect, it } from "@effect/vitest";
import { PERSONAL_THREAD_ID, reviewItemId } from "@yatma/core";
import * as Effect from "effect/Effect";

import * as EventStore from "../eventStore.ts";
import * as NodeSqlite from "../testing/nodeSqlite.ts";
import { receiveGmailMessage } from "./intake.ts";
import { makeCommitHub, makeMutationService } from "./mutations.ts";

it.effect("Gmail revisions deduplicate durable intake and preserve a user decision", () =>
  Effect.gen(function* () {
    yield* EventStore.migrate;
    const mutations = makeMutationService(yield* makeCommitHub);
    const message = {
      id: "abc",
      email: "person@example.com",
      subject: "Request",
      sender: "Sender",
      snippet: "Source evidence",
      historyId: "10",
    };
    yield* receiveGmailMessage(message, mutations);
    yield* receiveGmailMessage(message, mutations);
    let folded = yield* EventStore.loadFolded;
    const id = reviewItemId("gmail", "person@example.com:abc");
    expect(folded.reviewItems.size).toBe(1);
    expect(folded.chats.get(PERSONAL_THREAD_ID)?.messages).toHaveLength(1);
    expect(folded.tasks.size).toBe(0);
    expect(folded.dayEntries.size).toBe(0);
    yield* mutations.executeBatch({
      commands: [
        {
          type: "review.decide",
          input: { id, disposition: "later", revisitOn: "2026-12-01", reason: "Review next month" },
        },
      ],
      actor: { kind: "agent", chatId: PERSONAL_THREAD_ID, model: "test" },
      reason: "Review next month",
    });
    yield* receiveGmailMessage(
      { ...message, historyId: "11", snippet: "Updated source evidence" },
      mutations,
    );
    folded = yield* EventStore.loadFolded;
    expect(folded.reviewItems.get(id)?.sourceText).toContain("Updated source evidence");
    expect(folded.reviewItems.get(id)?.disposition).toBe("later");
    expect(folded.chats.get(PERSONAL_THREAD_ID)?.messages).toHaveLength(1);
    const stored = yield* EventStore.getEntity(id);
    expect(stored?.kind).toBe("review");
  }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
);
