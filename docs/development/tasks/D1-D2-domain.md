# D1/D2 — Domain planning, event order, and undo

Status: ready for assignment; shared plan/draft types require coordinator review first.

## Outcome and ownership

All writers share validated batch planning and ordered stamps. Undo restores an
entire batch while preserving later edits. Own `packages/core/src/**` and its
tests for this task, excluding `src/index.ts`; the coordinator owns package exports/manifests and the
never-rest contract package. Read the [interface register](../../internals/interfaces.md).

## Work

1. Propose `planBatch` / event-draft / failure shapes and the latest-write provenance
   required by undo. Identify consumers in mobile writes and Worker tools.
2. After coordinator agreement, implement pure staged planning and complete input validation.
3. Supply clock/ID inputs; monotonically stamp all drafts after observed history.
4. Aggregate undo by entity/field using earliest preimage and final batch provenance.
5. Keep version-1 readers and the current Effect-only core dependency boundary.

## Regression cases

- Overlong title/notes/reason/body and invalid references fail before persistence.
- A valid first command followed by an invalid command produces no writable batch.
- Two fields, repeated field writes, and create-then-update undo correctly.
- Later manual edits, including away-and-back values, are preserved with explicit skips.
- A future-but-allowed device clock does not put subsequent writes before creation.
- Multiple commands receive stamps in planned order; no-ops produce no events.

Run focused core tests, then `pnpm --filter @yatma/core typecheck`. Provide the
[standard handoff](../sub-agents.md#handoff-template), agreed public types, fixtures,
and migration notes for local/server writer agents. Do not rewrite their adapters.
