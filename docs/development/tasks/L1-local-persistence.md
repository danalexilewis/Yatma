# L1 — Serialized local persistence

Status: ready for failure reproduction and adapter design; planner consumers
depend on the coordinator-agreed D1 interface.

## Outcome and ownership

An edit is either durably committed and published or visibly failed. Concurrent
edits, remote merges, acknowledgement, and account changes cannot lose state.
Own mobile `src/db/**`, `src/events/**`, `src/state/**`,
`features/chat/undoBatch.ts`, and `src/application/mutations.ts`. Do not edit
sync/auth/UI files or package manifests. Read the [interface register](../../internals/interfaces.md).

## Work

1. Reproduce stale-snapshot concurrent writes and silent persistence fallback.
2. Propose the local repository/writer port and session-generation behavior.
3. Implement serialized snapshot → planning → stamping → atomic commit → publish.
4. Make remote event merge, projections, sequence metadata, and cursor one commit.
5. Add idempotent acknowledgement without replacing immutable event content.
6. Surface failures and select any preview-memory adapter explicitly.
7. Fence old work before session cleanup; expose awaitable methods for transport.

## Regression cases

- Two overlapping edits both survive reload and published state contains both.
- Event/projection failure rolls back; the UI does not publish a saved result.
- Remote merge failure leaves events, cache, and cursor unchanged.
- Early turn Changes frames and sync frames dedupe through the same repository.
- Duplicate acknowledgement is safe; conflicting historical payload is rejected.
- A sign-out/account switch during pending IO cannot repopulate the previous account.

Use a meaningful transactional adapter harness and an Expo SQLite runtime pass;
pure outbox helpers alone do not establish this outcome. Run focused tests and
`pnpm --filter @yatma/mobile typecheck`. Hand off committed-state and cursor APIs
to transport/UI owners using the [standard template](../sub-agents.md#handoff-template).
