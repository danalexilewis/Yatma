# Yatma private-alpha delivery plan

Status: active. Baseline: review of `5f94c25` on 2026-10-13; plan started 2026-10-14.

This is the execution plan for completing the [product vision](../product.md). The
[original M0–M4 plan](../../.cursor/plans/chat-first_tasks_spin-off.md) remains the
historical requirements source. Code across those milestones exists; milestone
acceptance has not been established by its presence.

## Outcome

A tester can manage tasks offline, reconnect two devices, ask the agent to make
several changes, background the app, recover the result, and undo the entire turn
without overwriting subsequent manual edits. Project briefs and handbook pages
keep useful context available, and voice provides another way to enter the same
command flow.

Preserve the existing Expo / Effect / Cloudflare architecture. Introduce explicit
application boundaries and migrate one area at a time. Every delivery task owns a
user-visible outcome, an interface, regression cases, and acceptance evidence.

## Current evidence

- The baseline has 64 passing tests and passing package typechecks.
- The web preview can add a task and retain it across reload.
- The iOS JavaScript/Hermes export succeeds; this is not a native build or device test.
- Existing convergence tests exercise fold/storage behavior, not two connected clients.
- The detached-turn test exercises registry bookkeeping; its socket-close helper is empty.
- Live Clerk, Cloudflare, OpenRouter, microphone capture, and TestFlight acceptance remain unverified.

The internals documents describe target invariants. This plan records when those
invariants actually become enforced and what evidence establishes them.

## Architecture and never-rest adoption

| Area                        | Responsibility                                                                    | Allowed dependency direction                                     |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@yatma/core`               | Domain schemas, validated planning, fold, clocks, undo, context, toolkit schemas  | Effect and its own modules only                                  |
| `@yatma/contracts`          | Shared never-rest contract modules and transport DTO/schema adapters              | Core, Effect, never-rest, neverthrow; no runtime implementations |
| Mobile application services | Local mutation writer, session lifecycle, sync and turn clients                   | Core/contracts and client-safe adapters                          |
| Worker application services | Serialized mutation writer, turn supervision, usage, knowledge, account lifecycle | Core/contracts and explicit runtime ports                        |
| Runtime adapters            | Expo SQLite, DO SQLite, Clerk, model provider, audio, HTTP/WebSocket hosting      | Consumed through application interfaces                          |
| UI                          | Commands, committed state, typed errors, live entity references                   | Application services and the existing UI library                 |

never-rest is the shared law for unary JSON operations and operation-addressed
dispatch. Effect remains the internal domain/application language; runtime
adapters convert expected failures to `RailError` / neverthrow `Result` once at
the boundary. Contracts reuse Effect schemas through `Schema.toStandardSchemaV1`.

Streaming sync/turn frames and audio bytes stay in the transport host. They have
their own schemas and lifecycle rules. A subscription disconnect does not own
the lifetime of a turn. See the [interface register](../internals/interfaces.md)
and [never-rest guide](../development/never-rest.md).

### Initial adoption delivered in this change

- Pin `@eddy-works/never-rest` 0.7.0 and neverthrow 8.2.0 in the pnpm catalog.
- Add `@yatma/contracts/health` and `@yatma/contracts/sync` as separate contract modules.
- Serve existing `GET /` and `GET /health` through the health contract.
- Keep WebSocket upgrades on those paths in the existing authenticated host branch.
- Define `pushEvents` from the current core DTOs, without mounting an unsafe new sync route.
- Exercise JSON round trips, validation before handler execution, typed errors,
  public disclosure, typed HTTP clients, and cooperative host mounting.
- Add scoped agent instructions and the ownership/dependency workflow.

Health reports the process/stack stage; it does not prove identity, storage, or
provider readiness. Only the health contract is mounted. The sync contract is an
agreed starting shape for phase 2 and may change through the contract owner.

A0 validation on 2026-10-14: Node 24.21.0 / pnpm 11.10.0, 70 passing tests in
16 files, all four workspace package typechecks passing. The tests exercise the
local/HTTP boundary; no cloud deployment was performed for this adoption step.

## Work items and gates

| ID  | Outcome                                                                   | Owner lane           | Dependencies          | Initial status             |
| --- | ------------------------------------------------------------------------- | -------------------- | --------------------- | -------------------------- |
| A0  | Contract package, first never-rest mount, interface register, agent setup | Integrator/contracts | None                  | Implemented in this change |
| D1  | Validated batch planning and monotonic event order                        | Domain               | A0                    | Pending                    |
| D2  | Whole-batch undo that preserves subsequent edits                          | Domain               | D1                    | Pending                    |
| L1  | Serialized, durable local commands and remote merges                      | Local persistence    | D1 interface agreed   | Pending                    |
| S1  | Atomic server journal and idempotent acknowledgement                      | Durable persistence  | D1 interface agreed   | Pending                    |
| T1  | Live sync, reconnect, acknowledgement after durable merge                 | Transport            | L1, S1                | Pending                    |
| R1  | Idempotent turn start, independent lifetime, progress and recovery        | Agent runtime        | S1, T1 interfaces     | Pending                    |
| R2  | Shared model toolkit and daily usage reservations/accounting              | Agent runtime        | S1, R1 interfaces     | Pending                    |
| U1  | Durable change cards, scoped chat/capture, manual recovery flows          | Product UI           | D2, L1, R1 interfaces | Pending                    |
| K1  | Bounded inspectable context, editable briefs, pins, handbook curation     | Knowledge            | D1, R1, R2, U1        | Pending                    |
| V1  | Actual recording, transcription, editable transcript, quick action        | Voice                | R1, R2 interfaces     | Pending                    |
| I1  | Account/session isolation and truthful deletion completion                | Identity/transport   | L1, S1, R1            | Pending                    |
| E1  | CI, native/cloud acceptance, configured tester build                      | Integrator/release   | All alpha gates       | Pending                    |

### Phase 1 — Make event writes and undo trustworthy

Run domain, local persistence, and durable persistence tasks concurrently once
the writer/planner interface shapes are agreed. Freeze those shapes before
agents independently implement them.

**D1: domain planning and event order**

- Validate every command, field cap, reference, and required agent reason before persistence.
- Stage each command against the results of preceding commands in its batch.
- Use observed maximum event time and increasing batch timestamps for every writer:
  manual commands, agent tools, messages, curator, undo, and restore.
- Keep stored event version `v: 1` readable; change schemas additively or define a migration.
- Reject a repeated event ID carrying different historical content.
- Use plain schema failure data consistent with the project's class restrictions.

**D2: undo**

- Aggregate the earliest preimage and final value/provenance for each field.
- Handle separate fields, repeated field writes, and create-then-update in one batch.
- Preserve later edits, including an edit that changes a value away and back.
- Return explicit skips; the UI must not imply everything was undone when it was not.
- Discover all committed writes for a turn by durable batch identity.

**L1: local persistence**

- Serialize snapshot → plan → stamp → commit → publish, rather than accepting a stale caller snapshot.
- Commit the local event batch and projections together.
- Commit remote events, sequence metadata, projections, and cursor together.
- Serialize acknowledgement and remote merge with local writes.
- Surface storage failures; any preview-only memory adapter must be explicit.
- Fence asynchronous work by account/session generation before sign-out or account switch.
- Keep event content immutable; authoritative sequence metadata may be added separately.

**S1: server persistence**

- Prevalidate the entire incoming batch, then atomically append, project, and update FTS.
- Return sequence assignments for both newly inserted and already stored event IDs.
- Publish notifications only after commit.
- Keep model/provider work outside database transactions and mutation locks.

**Gate:** invalid second event writes nothing; injected projection/FTS failures
roll back; concurrent local edits survive reload; lost acknowledgement retries
receive original assignments; undo restores the original batch state while
preserving intervening edits; a device clock one hour ahead does not defeat a
later server or undo change.

### Phase 2 — Complete live sync and turn execution

**T1: sync**

- Mount authenticated unary operations through never-rest adapters that call the safe writer.
- Keep legacy Effect RPC adapters until consumers have migrated and compatibility tests pass.
- Establish catch-up plus live delivery without a handoff gap.
- Separate subscription readiness/handle creation from eventual stream completion.
- Start outbox flushing while the subscription remains live.
- Await durable remote merge before acknowledgement; keep cursors monotonic and committed.
- Retain typed failures through the mobile boundary: clock correction, authentication,
  validation, budget, cancellation, and temporary unavailability.
- Reconnect from committed cursors with fresh authentication and bounded retry/backoff.
- Keep the active session stable across ordinary UI state updates/re-renders;
  only session identity or explicit lifecycle changes should restart it.

**R1: turn supervision**

- Start a turn by client request/message identity, rather than text equality.
- Return stable chat/turn/batch IDs promptly; starting the same request twice attaches to one turn.
- Separate start/get/stop control operations from observation streams.
- Let the DO-owned supervisor run independently of request/subscriber disconnection.
- Persist turn state, final messages, and aggregate batch metadata for recovery and cards.
- Define the DO restart/eviction guarantee explicitly. Do not replay model/tool work
  after restart without an idempotent checkpoint strategy; surface interrupted status when needed.
- Stop explicitly cancels provider/tool work; a cancelled observation only detaches that observer.

**R2: model and spend**

- Use the core toolkit with a real `effect/ai` provider adapter and a scripted model adapter.
- Eliminate the manually duplicated tool specification and dispatch validation.
- Reserve usage before provider work; serialize admission across turns and curator calls.
- Record actual spent usage, including overshoot and failed/cancelled calls when reported.
- Settle/release reservations on every exit path.
- Use a UTC daily cap for the first alpha and show the actual reset time in Settings.

**Gate:** an idle second client receives an edit; ordinary state updates do not
restart sync; reconnect does not lose events;
`started` precedes model completion; closing the real request/socket does not
cancel a turn; stop works before a new chat's reply; repeated identical messages
remain separate requests; results and the complete batch survive reload; cap
overshoot is recorded and blocks subsequent admission.

### Phase 3 — Close the product loops

**U1: task and chat experience**

- Add completed/deleted task browsing, reopen/restore, project edit/archive controls,
  and the planned Doing/capture interactions.
- Provide a clear sign-in entry while preserving intentional offline use.
- Carry task/page/project scope into Discuss, Ask about this, and new project chats.
- Keep capture open through its result and undo; accumulate the full turn's writes.
- Render durable change cards with reasons, applied/undone/partially skipped state,
  inline reference chips, and live task lists with status controls.
- Match the [chat task presentation reference](../product.md#tasks-inside-chat):
  flat status-grouped lists, interactive open/checked circles, bold live titles,
  regular-weight inline commentary, and wrapped text aligned with the title.
  Circle taps complete/reopen; title taps open the task sheet. Keep the full
  turn's change summary and Undo available alongside the task list.
- Display actionable typed errors without presenting a failed write as saved.

**K1: knowledge**

- Apply a bounded context policy to briefs, pinned bodies, summaries, messages, and indexes.
- Share active-chat input and the resulting context snapshot between model and preview.
- Make briefs editable and pages pinnable; render page markdown and version restore.
- Curate handbook pages as well as chat metadata and briefs, using existing knowledge
  as input and the same writer, usage ledger, and durable batch/card path.
- Check whether an idle callback was superseded before spending or writing.

**V1: voice**

- Record actual audio with permissions and interruption/error states.
- Connect iOS on-device transcription and the supported cloud fallback.
- Wire the Workers AI or configured provider adapter through deployment configuration.
- Let users edit transcripts; persist and consume the auto-send preference.
- Verify the home-screen shortcut reaches the same capture flow on a device.

**I1: identity and deletion**

- Stop/fence sync and writers before local cleanup.
- Coordinate deletion with active turns, curator callbacks, DO writes, and Clerk.
- Retain retryable deletion progress until external work completes; never report
  successful remote deletion when it was skipped or failed.
- Prevent stale callbacks or another client from recreating deleted task state.

**Gate:** every forward action has its recovery action; scoped conversations
receive the intended entity; change cards are recoverable; real microphone input
produces an editable transcript; context stays within budget; deletion failure
remains visible/retryable and session switches do not mix data.

For chat task rows, verify the reference layout with long titles/commentary,
completed and outstanding groups, local completion dates, light/dark themes,
accessible checked states, and separate circle/title interactions. Toggle offline,
reload, receive a remote edit, and confirm the rows remain live and failures are
visible. Visual approval is separate from the mutation/sync acceptance gates.

### Phase 4 — Establish release evidence

- Add Node 24 / pnpm 11.10.0 CI for tests, all package typechecks, and dependency-boundary checks.
- Add contract/output fixtures and shared application conformance tests.
- Run Expo SQLite and Cloudflare tests in their actual runtimes, including FTS5 and lifecycle behavior.
- Run the integrated scenario below on two connected clients and on iPhone/Android.
- Configure real EAS/App Store Connect identifiers, stages, auth, and model/audio bindings.
- Produce the tester build and record build IDs, tested devices, commit, results, and remaining limitations.

Only mark work complete when its gate passes. Unit tests, bundle export, native
build, device interaction, and deployed cloud acceptance are different evidence.

## Integrated acceptance scenario

1. Sign in on two devices; confirm each has isolated local session state.
2. Disconnect one device, create/reorder/triage tasks, and restart it offline.
3. Reconnect; both devices converge without manual refresh.
4. Ask the agent for several changes, including two updates to one task.
5. Background the app before completion; recover the result and all change reasons.
6. Make a later manual edit, reopen the durable card, and undo the complete turn.
7. Confirm only batch-owned changes revert, skips are explained, and both devices agree.
8. Wrap up the project; verify brief/handbook updates, context preview, usage, and undo.
9. Capture a real dictated command and follow the same result path.
10. Exercise cap failure, storage failure, sign-out, and retryable deletion failure.

## Parallel execution

Use a coordinator and at most three active implementation agents. Assign file
ownership explicitly, including composition files and shared schemas. Contract
changes go through the coordinator; agents do not independently invent equivalent
DTOs or edit manifests/lockfiles. See [sub-agent setup](../development/sub-agents.md).

## Deferred work

The T3 bridge/MCP endpoint, Focus timers, reminders/push, widgets, and additional
clients follow alpha acceptance. never-rest's dispatcher provides a future MCP
seam; this change does not expose an MCP server or grant agents account access.
