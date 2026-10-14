# S1 — Atomic durable journal

Status: ready for assignment; planner consumers depend on the coordinator-agreed
D1 interface. Incoming-event transaction/retry fixes can start independently.

## Outcome and ownership

A rejected batch writes nothing. Successfully stored events have matching
projections/FTS, and a retry recovers its original sequence assignments. Own
Worker `eventStore*`, `testing/**`, `src/application/mutations.ts`, and new journal adapter modules.
`UserSpace.ts`, runtime host/auth, manifests, and contract declarations remain
with their assigned integrator. Read the [interface register](../../internals/interfaces.md).

## Work

1. Validate the complete batch before starting writes.
2. Commit event append, projections, and FTS in one transaction.
3. Return assignments for new and duplicate IDs; reject conflicting content.
4. Expose batch reads and post-commit observation with a gap-free sync handoff design.
5. Consume the agreed planner through a serialized snapshot/plan/stamp/commit writer.
6. Keep provider IO outside the transaction/lock and preserve version-1 history.

## Regression cases

- Invalid second event leaves no first event, projection, or FTS row.
- Projection/FTS failure rolls back the append and sequence-visible result.
- Lost-response duplicate retry returns each original sequence assignment.
- Same ID with different historical content is rejected without altering history.
- Published notifications contain only committed data.
- Ordered history and FTS queries behave in the actual DO SQLite runtime.

Run focused Worker tests and `pnpm --filter @yatma/worker typecheck`. Record the
distinction between `node:sqlite` and Cloudflare acceptance. Hand off journal
ports, fixtures, and the host wiring request through the
[standard template](../sub-agents.md#handoff-template).
