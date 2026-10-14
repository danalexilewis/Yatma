# Sub-agent setup

Use this workflow for the [private-alpha plan](../plans/private-alpha.md). Read the
root and scoped `AGENTS.md`, the [interface register](../internals/interfaces.md),
and the [never-rest guide](never-rest.md) before taking ownership of an area.

## Coordinator responsibilities

The coordinator owns the outcome, task graph, shared contract decisions, and
integration evidence. Run at most three implementation agents alongside the
coordinator. Delegation is useful when work has independent owned files and an
agreed interface; do not split one shared file across active agents.

Before assigning a task:

1. Record its outcome, dependencies, owned paths, interface version, and checks.
2. Establish whether the interface is agreed or still a proposal.
3. Assign one owner for every edited file, including tests and exports.
4. Supply the task brief and necessary context directly to the agent.
5. Record the handoff and run the integration gate before marking the item complete.

Agents share the working tree unless the coordinator explicitly creates separate
worktrees. Do not switch branches, reset, clean, or discard another agent's work.
Do not delegate again unless the assignment authorizes it and slots are available.

## Ownership lanes

| Lane                         | Owned area                                                                                                      | Boundary handed to consumers                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Domain                       | `packages/core/src/**` and its tests                                                                            | Validated plans, stamps, undo, context, shared event/tool DTOs   |
| Contracts/integrator         | `packages/contracts/**`, manifests, lockfile, exports, root config, docs                                        | One never-rest contract per area and error vocabulary            |
| Local persistence            | Mobile `src/db/**`, `src/events/**`, `src/state/**`, `features/chat/undoBatch.ts`, new local application writer | Serialized commits, durable remote merge/cursor, batch recovery  |
| Durable persistence          | Worker `eventStore*`, `testing/**`, new journal/writer adapter modules                                          | Atomic append, assignments, commit observation, batch reads      |
| Transport                    | Mobile `src/sync/**`, `features/auth/AuthProvider.tsx`; explicitly leased Worker host/composition files         | Unary adapters, live stream lifecycle, session fencing           |
| Agent runtime                | Worker `src/agent/**`, `curator.ts`, turn proof/tests, new supervisor/usage modules                             | Start/get/stop services, progress, model and usage ports         |
| Product UI                   | Mobile features/routes except files leased above                                                                | Commands, durable cards, scoped navigation, reversal flows       |
| Knowledge / voice / identity | A narrowed task-specific subset of the appropriate lane                                                         | Established writer/turn/usage contracts consumed by each feature |
| Release                      | `alchemy.run.ts`, EAS/app config, CI, acceptance harness/evidence                                               | Tested and configured tester build                               |

Domain ownership excludes `packages/core/src/index.ts` unless the coordinator
explicitly delegates export wiring. The first-wave writer-file leases are
`apps/mobile/src/application/mutations.ts` for L1 and
`apps/worker/src/application/mutations.ts` for S1.

`UserSpace.ts`, `worker.ts`, `auth.ts`, root/mobile providers, and `state/atoms.ts`
are composition choke points. Name their single owner in each wave. The runtime
agent supplies a module and wiring request; it does not silently edit the host
owned by transport. Account work must acquire the same ownership before changing
deletion/session wiring.

The coordinator owns dependency installation and whole-repository checks.
Implementation agents can run focused tests/typechecks, but do not concurrently
install packages or run a formatter across another owner's files.

## Execution waves

### Wave 0 — Boundaries

The initial never-rest package/health mount and interface register are established.
The target writer/planner/turn DTOs still need their implementation proposals.
The coordinator reviews and records those shapes before consumers depend on them.

### Wave 1 — Reliable data

Run domain, local persistence, and durable persistence agents. Start with these
ready-to-assign briefs:

- [D1/D2: domain planning, event order, and undo](tasks/D1-D2-domain.md)
- [L1: serialized local persistence](tasks/L1-local-persistence.md)
- [S1: atomic durable journal](tasks/S1-durable-persistence.md)

Domain first proposes the shared plan/draft types. Persistence agents can
reproduce failures and build runtime/transaction harnesses while that proposal
is reviewed. They implement planner consumers after the coordinator agrees the
shape. Existing incoming-event journal semantics can be repaired independently.

### Wave 2 — Sync and agent flow

Run transport, runtime, and product agents against the agreed data interfaces.
Only the leased composition owner wires `UserSpace` and providers. Product work
can build against scripted service fixtures; record any runtime dependency still
preventing acceptance.

### Wave 3 — Knowledge, voice, identity

Assign narrowed tasks once turn, writer, usage, and session interfaces stabilize.
Avoid overlapping product-feature leases. Do not run account cleanup work
concurrently with another owner editing runtime/session composition.

### Wave 4 — Integrated acceptance

One integrator owns the two-client/background/undo scenario, deployed proofs,
native acceptance, and configured tester build. Other agents can review failures
or complete clearly isolated fixes. Each re-test should resolve a known failure
or changed behavior rather than repeatedly broadening a passing check suite.

## Contract changes

Contracts are shared law. An agent proposing a change sends the coordinator:

```text
Interface and work-item ID:
Current shape and proposed shape:
Behavior/invariant requiring the change:
Affected callers, adapters, fixtures, and persisted readers:
Compatibility and migration:
New regression case:
```

Coordinator approval is coordination within the authorized task, not an extra
user permission step. Consumers update together. Keep drafts clearly labeled;
do not implement separate DTO copies, manual model-tool schemas, or bypasses
with `any` / `as never` to get ahead of an unresolved contract.

Never-rest contracts stay in `packages/contracts/src/<area>.ts`. HTTP handlers,
local dispatchers, typed clients, fixtures, and future OpenAPI/MCP projections
import that object. Core retains its Effect-only dependency boundary.

## Assignment template

```text
Task and work-item ID:
User-visible outcome:
Review findings addressed:
Dependencies and agreed interface version:
Owned files/area, including composition files:
Read-only dependencies:
Public interfaces to consume:
Public interfaces allowed to change:
Required regression cases:
Focused checks:
Acceptance evidence:
Explicit exclusions:
Handoff destination and next task unblocked:
```

## Handoff template

```text
Outcome and changed files:
Public contract changes:
Invariants now enforced:
Commands run and actual results:
Manual/native/cloud evidence:
Remaining failures or unverified behavior:
Wiring requested from another owner:
Next task unblocked:
```

Report out-of-scope findings rather than opportunistically editing another lane.
Distinguish unit-test evidence from native/cloud evidence. Do not mark a stub,
scripted registry proof, or bundle export as end-to-end acceptance.

## Checks

- Use Node `^24`, pnpm `11.10.0`, Effect `4.0.1`, Alchemy `2.0.0-beta.80`.
- Root suite: `pnpm test`; focused example: `pnpm exec vp test run packages/core/src/undo.test.ts`.
- Area check: `pnpm --filter @yatma/core typecheck` (replace with the owned package).
- Coordinator integration: `pnpm test` and `pnpm -r typecheck`.
- Runtime acceptance uses actual Expo SQLite / Cloudflare / native devices as
  specified by the work item; `node:sqlite` does not stand in for those runtimes.
