# Sync internals

Invariants for the local-first event log and `UserSpace` sync. These must not drift without an intentional migration.

## Event log

- **Append-only.** Never rewrite, update, or delete a stored event line. Corrections are new events (including undo batches that carry `undoes`).
- **Schema version `v`.** Events carry `v`. Bumping `v` requires shipping a reader that still understands every older version still present in any client or Durable Object log. Dropping an old reader is only allowed after a completed migration that rewrites (or dual-writes) every stored line—something this design avoids by keeping append-only history and additive schemas.
- **Identity.** Event ids are ULIDs. Duplicate ids on `sync.push` are ignored (idempotent append). Fold drops duplicate ids and sorts by `(at, id)`.
- **`seq`.** Assigned only by the server, monotonically increasing **per user** (per `UserSpace`). Absent `seq` means the event is still in the phone outbox.

## Clock

- **Device stamp.** Each device sets `at = max(now, lastSeenAt + 1ms)`, where `lastSeenAt` is the maximum `at` among events that device has already applied. An edit always sorts after everything that device has seen.
- **Server reject.** `UserSpace` rejects events whose `at` is more than **one day ahead** of server time (`isTooFarAhead`). The app should prompt the user to fix the device clock.
- Helpers live in `@yatma/core`: `nextAt`, `isTooFarAhead`, `DAY_MS`.

## Outbox

- The phone’s outbox is **events without `seq`**—not a separate table of pending payloads.
- Retry pushes those rows via `sync.push` until the server assigns `seq` and the phone updates the local rows.
- `chat.send` includes the phone’s unsent events so the agent sees local work that has not yet completed a push round-trip.

## RPCs

| RPC | Role |
| --- | --- |
| `sync.push` | Append events; ignore known ids; assign `seq`; fold into DO entities. |
| `sync.subscribe({ after })` | Stream missed events after the cursor, then live appends. Phone keeps `after`. |

## Agent events (dedupe)

Agent-written events reach the phone **twice**:

1. Immediately as `Changes` items on the `chat.send` stream.
2. Durably through `sync.subscribe`.

The phone **dedupes by event `id`** before applying. Never treat the two paths as two writes.

## Sign-out and account deletion

- **Sign out** wipes the phone’s SQLite database (events, entities, outbox, cursors). The next sign-in starts clean and resyncs from the DO.
- **`account.delete`** clears the user’s Durable Object state and deletes the Clerk user. Required for App Store compliance when account creation exists.

## Convergence

Two devices converge when both have applied the same set of event ids (same fold inputs). Order of delivery may differ; fold’s `(at, id)` sort and last-write-wins field merge make the folded entities equal.
