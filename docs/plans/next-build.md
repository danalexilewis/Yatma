# Yatma next build: conversation and a day ready to play

Conversation review follow-on (2026-11-11): see [conversation prioritisation](conversation-prioritisation.md) for implementation status, Gmail setup, and remaining acceptance.

Planning date: 2026-11-10. Status updated 2026-11-11: local feature implementation
is delivered; external acceptance remains pending at the user's direction.
Evidence below does not imply native or deployed acceptance.

This is the next-build sequence under the [private-alpha delivery plan](private-alpha.md).
It consolidates the [thread-widget design](thread-task-widgets.md),
[daily stack/player design](daily-stack-player.md), and existing startup,
sync, and device acceptance work. Those designs retain their facade and task
IDs; this document orders the work across them. The private-alpha plan remains
the release gate. Checkboxes require the stated evidence, not just implementation.

## Product refinements — 2026-11-11

The user's subsequent direction supersedes the compact dock, composer mode menu,
all-backlog daily assembly, and matrix surface described in the original tasks
below. Existing event history and daily commitments are preserved.

| Requested outcome              | Implemented behavior                                                                                                                                                                                                                                             | Verified local evidence                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop menu                   | Collapsible sidebar, project navigation, New task, searchable keyboard quick switch; mobile keeps touch tabs                                                                                                                                                     | Browser navigation and Cmd/Ctrl K search; resizing preserves the conversation draft                                                                                                                                                                       |
| One focus surface              | No separate dock. Desktop uses a left-third timer/current task/scrollable queue and right-two-thirds ambience. Mobile uses a full-screen scene, current controls at the bottom, then the stack below in one page scroll                                          | Actual Expo web at 1280×800, 390×844 and 844×390; full-scene bounds, reachable bottom controls and stack scrolling inspected. Linked focus task and quick-switch results open the existing TaskSheet with origin preserved                                |
| Better ambience                | Original bundled forest/waterfall, rainy-window and coast images; original 36-second stereo loops with continuous joins; independent gain/mute, interruption ownership and retry                                                                                 | Asset dimensions/visual inspection, deterministic audio generation/peak/seam checks, five playback lifecycle tests. Browser scene/drawer/mute and autoplay fallback observed; native listening/interruption acceptance remains pending                    |
| Conversation as query/planning | Ordinary message input; local `/list` for the entire open backlog, task/project `@` autocomplete, live identity refs; mode picker and chat Projects/Matrix shortcuts removed                                                                                     | Local list/commit-failure/retry and >50-task tests; browser `/list`, keyboard project/task insertion, end caret plus typed suffix, and resize draft checks. Pure mention tests cover escaping, duplicate identity, stale/deleted records and middle edits |
| Deliberate daily commitments   | New days instantiate the opening routine without pulling in all backlog. Manual selection, loaded routines, carried work and explicit model planning select the stack. Matrix navigation/settings/detail controls are removed; old matrix URLs redirect to Today | Application regression excludes unchosen backlog and retains explicit additions; existing daily/Undo/convergence tests pass. Existing days are not silently pruned                                                                                        |
| LLM stack tools                | Shared `read_day`, `plan_day`, project read, paginated backlog; device planning calendar travels through the existing turn contract/supervisor. Explicit changes commit through the serialized mutation writer with audited reasons                              | Scripted real `runAgentTurn` read→plan→committed changes/reply; suggestion-only turn writes no day entries, invalid/foreign-day operations roll back, pagination/done filters, contract timezone rejection and turn retry identity tested                 |

Final local checks use Node 24.22.2 / pnpm 11.10.0: **304 tests in 49 files**,
all four package typechecks, package boundaries, Gurki lint and `git diff --check`
pass. Expo exports Web, iOS and Android JavaScript successfully. Exporting is not
a native build or device test. Actual model-provider, Cloudflare, Clerk and real
device acceptance stays pending under N15–N17 as requested.

Today/task presentation follow-up (2026-11-11): implemented compact title/project/
worked-time metadata across Today, conversation widgets, project lists and the
Focus queue. Missing project/time values render nothing. Lifetime task effort
includes historical/deferred entries and corrections, with overlapping runs
counted once. Today exposes direct action icons beside Play and an Open button
for task/activity details; the three-dot accordion is removed. Daily allocation
editing lives in the detail dialog. The current entry retains extra playback
controls and remaining time.

Today reordering uses browser drag events on web and the existing native draggable
list on iOS/Android. Keyboard and accessibility moves use the same committed
`day.move` command. Local evidence: 319 tests passed in the full suite, followed
by four new browser-drag renderer cases (323 total across 52 files); all four
package typechecks, boundary checks and `git diff --check` pass on Node 24.6.0.
The focused cases cover drop indices/cancellation/disabled writes, immediate
handle activation, tap/hold separation, direct actions/Open, missing metadata,
lifetime effort, failed-save retry and journal reload. Actual Expo SQLite web
at 1280×800 and 390×844 verified direct controls, linked-task/activity dialogs,
project metadata, live/persisted worked time and no accordion. Dispatched browser
drag events and keyboard moves changed Today order; a page reload retained it.
Physical native drag and touch-browser drag remain unverified.

Subsequent refinement: Today action icons appear on desktop hover/keyboard focus
or after tapping a row on mobile. Starting a different item atomically promotes
it to the front and places the interrupted item immediately next, preserving
the remaining queue and recorded effort. Domain regression covers successive
switches; all package typechecks and the focused renderer/policy tests pass.

Preference learning and proactive morning suggestions remain future product
work. The current prompt can discuss a proposed day using recorded briefs/history;
it does not claim invented preferences or turn a suggestion into a commitment.

Ownership: the coordinator owns routes/navigation, focus/Today, shared model
schemas/refs, optional planning DTO and writer-reason wiring. The conversation
lane owns composer/mentions/local list/renderers; the Worker lane owns daily
planning handlers/dispatch/context and scripted evidence; the media lane owns
original images/audio and the isolated playback adapter. Shared composition and
schema changes were integrated by the coordinator.

## Execution ledger — 2026-11-10

Scope confirmed on 2026-11-11: finish local implementation and keep external
N15–N17 acceptance pending. The local features, automated checks, offline
convergence/profile harness and all-platform JavaScript exports are delivered.
Device/backend setup and tester distribution are deferred; they are not
prerequisites for reviewing or using the unsigned local workspace. Unverified
browser/navigation details below remain acceptance gaps rather than completed
checks. The product refinements below are subsequent implementation work.

Baseline commit: `2ecc747` (merged private-alpha foundation). The only initial
working-tree change was the earlier untracked core `dailyStack.ts` helper; it is
now integrated into the daily domain implementation. Checks ran with Node
24.22.2 and pnpm 11.10.0, leaving the machine's default Node unchanged.

- `pnpm test`: 35 files, 170 tests passed before implementation.
- `pnpm -r typecheck`: all four packages passed before implementation.
- `pnpm check:boundaries`: passed before implementation.
- `pnpm dev:web`: root startup served port 8081; collaborative browser opened the
  actual Expo SQLite web workspace. Manual task capture “Next build baseline
  capture” survived reload. A second browser tab then displayed the storage-lock
  failure gate with no editor. Releasing the first tab and choosing Reload
  recovered the saved workspace, including all five task references.

| Items   | State                                               | Ownership / current evidence                                                                                                                                          |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N00     | verified locally                                    | Supported toolchain checks, actual Expo SQLite web capture/reload and failure/recovery above                                                                          |
| N01     | implemented; local fixtures verified                | Core schemas/commands, merge and Undo fixtures; pinned Gurki tool; DSP-28/29 added                                                                                    |
| N02–N03 | implemented; local behavior verified                | Thread/parser/coordinator tests; five browser copies agree through complete/reopen/reload                                                                             |
| N04     | implemented; partial verification                   | Flattened virtual rows and 50/50/150 windows tested; native reading-anchor pixel behavior remains unverified                                                          |
| N05     | implemented; partial web verification               | Atomic capture/Show tasks tests; browser overlay Escape retains draft and restores title focus; project navigation and native navigation acceptance remain unverified |
| N06     | implemented; domain checks verified                 | Daily schemas/events/fold/policy/Undo; calendar, concurrency, breaks, templates and corrections                                                                       |
| N07–N08 | implemented; local checks verified                  | Both adapters transact all new projections; failed-transfer rollback/retry; HTTP/RPC reader gates and strict frame decoders                                           |
| N09–N10 | implemented; local checks verified                  | Serialized account runtime, timestamp recovery, shared completion, reminder/microphone ownership; device reminders/background behavior unverified                     |
| N11–N13 | implemented; local checks and browser loop verified | Today, independent order, actual time, routines, automatic/manual breaks, carried commitments and controls; native drag/interruptions unverified                      |
| N14     | implemented; partial verification                   | Expanded focus, original bundled scenes/audio and independent preferences; browser scene changes retain run; actual native audio/dictation unverified                 |
| N15     | local work delivered; external acceptance pending   | Offline event-stream convergence and local profiling verified; connected-client acceptance deferred by user                                                           |
| N16     | external acceptance pending                         | Backend/auth/model setup and native/Cloudflare/device acceptance deferred by user                                                                                     |
| N17     | local work delivered; tester rollout pending        | Local regression/type/boundary/spec checks and all-platform JS exports done; configured native tester build/distribution deferred by user                             |

Shared decisions: additive v1-envelope records use reader capability 2; absent
capability is legacy and sync rejects it before reads, writes or cursor delivery.
Event-bearing turn start/get/observe, legacy chat/send and wrap-up are gated too.
Server readers and gates deploy before new clients/writers. Semantic day/task and
template origins deduplicate entries; event IDs remain unique per payload. First
creation wins, edits use existing event-order field resolution. Tomorrow is one
batch, actual intervals stay on their source day, and task Undo never restarts a
historical interval. Known remote recording blocks another start; independently
started offline intervals remain visible conflicts. Audio preferences never alter
work state. Exact models are in core `stackSchemas.ts` / `dailyCommands.ts`.

### Verification and remaining release gates

Final local suite: **273 tests across 46 files pass** under Node 24.22.2.
All package typechecks, boundary check, Gurki lint and `git diff --check` pass.
The `check:specs` command uses Gurki pinned to upstream commit
`d1b1f7fad53fc5c880a23faccd9007cdce7fa250` through the pnpm catalog/lockfile;
CI runs it. These are application tests and spec lint, not 72 accepted device paths.

Browser evidence (actual Expo SQLite web, local unsigned workspace):

- WTW repeated-copy flow: Show tasks five times; complete the first copy and
  reopen the fourth; all five checkbox labels/states agree. Reload retains them.
- WTW overlay flow: open task details over a draft, Escape, and read the same
  draft with focus restored to the originating title. Background conversation is retained.
- DSP durable loop: the day opens with 10/5/30 and existing tasks plus an automatic
  break. Play a real task, pause/reload, extend 5 minutes, Later twice, Tomorrow.
  The source retains 1:15 actual; the next-day preview retains a 33:44 commitment
  after reload. Domain tests separately assert unchanged task due date/global order.
- DSP shared completion: play a linked task, then complete its fifth chat copy.
  All five checkboxes become checked and the dock has no running control. Reload
  preserves completion and stopped time. Focus scene selection/mute changed while
  another interval continued recording; no synthetic completion/advance occurred.
- Storage recovery: second-tab acquisition failure shows only recovery controls;
  release owner/reload recovers task and day data without clearing storage.

Relevant evidence fixtures:
[core daily policy](../../packages/core/src/dailyStack.test.ts),
[timestamp/timezone validation](../../packages/core/src/stackValidation.test.ts),
[offline convergence](../../packages/core/src/stackConvergence.test.ts),
[local writer/Undo](../../apps/mobile/src/application/mutations.test.ts),
[database transactions](../../apps/mobile/src/db/database.test.ts),
[player/reminder ownership](../../apps/mobile/src/application/stackPlayer.test.ts),
[microphone lifecycle](../../apps/mobile/src/application/recordingLifecycle.test.ts),
[sync upgrade recovery](../../apps/mobile/src/sync/engine.test.ts),
[HTTP capability gates](../../apps/worker/src/http/user.test.ts), and
[Worker projection transactions](../../apps/worker/src/eventStore.test.ts).

Run `pnpm profile:next-build` for the local CPU/Node SQLite profile. At 1,000 vs
5,000 messages (30 days, 600 intervals), initial three-sample medians were 9.515 vs
14.916 ms for journal read/schema decode, 22.651 vs 359.189 ms for full fold,
1.700 vs 2.710 ms for cached projection read/JSON decode, and 0.428 vs 0.272 ms
for flattening the retained 150-message window. Both retain 499 presentation rows;
a single 200-task reply becomes 201 individually keyed rows. These are in-memory
Node measurements, excluding disk, Expo VFS, native rendering and Cloudflare.
Full-journal growth remains a scaling concern; bounded rendering does not fix it.

The later browser project-navigation recheck was not accepted as evidence after
the collaborative preview began returning automation execution errors; earlier
successful browser flows above remain recorded. Pixel reading-anchor behavior
and native navigation still require their explicit acceptance passes.
The 2026-11-11 retry also returned inconsistent automation results, so it does
not establish project-navigation acceptance. The feature remains implemented;
this follow-up adds no new passing browser or application-test claim.

`expo export --platform all` produced web assets and iOS/Android Hermes bundles
in `/tmp/yatma-next-export`. This is compilation evidence, not a native app build.
App version is 0.2.0 so the appVersion runtime separates the newly required native
notification module from 0.1.0 builds. No native build, deployment, push, merge or
tester distribution was performed.

External blockers observed: mobile/Worker `.env` files are absent; Cloudflare,
Clerk, OpenRouter, mobile sync URL and Expo credentials are unset in this shell;
ADB reports no attached devices and no iOS simulator is booted. Existing EAS
project identifiers remain configured, but do not supply the missing bindings or
establish sign-in, real Cloudflare transactions, notification delivery, audio
interruptions or tester acceptance. N15–N17 remain open for those exact gates.

## Build outcome

Yatma has two everyday surfaces sharing the same durable tasks:

- **Chat:** a permanent conversation containing live, interactive task blocks.
  Repeated references are useful; checking one updates every copy.
- **Today:** a daily inbox assembled into an editable stack. Press Play, see the
  current task and time, take breaks, and adapt the day without a failure penalty.
  Expand the player for focus and choose an ambient media scene.

A complete demonstration starts with 10 minutes mindfulness, 5 minutes
reprioritisation, and 30 minutes clearing email, followed by existing task order.
Breaks are already included. The person extends one item, sends another to the
bottom twice, defers one to tomorrow, changes the scene, and finishes a task from
one of five chat references. All task copies agree; tomorrow's commitment and
actual time survive reload and sync. Existing offline capture, agent recovery,
whole-turn Undo, projects, Matrix, and dictation continue working.

| Checkpoint           | Tasks   | Reviewable result                                                         |
| -------------------- | ------- | ------------------------------------------------------------------------- |
| Foundation           | N00–N01 | Reproducible baseline and explicit domain/compatibility contracts         |
| Simpler conversation | N02–N05 | Live task blocks, bounded history, overlays, and offline capture receipts |
| Durable daily loop   | N06–N11 | Today with real tasks, actual time, editing, and flexible deferral        |
| Ready to play        | N12–N14 | Daily assembly, routines, automatic breaks, expanded player, and scenes   |
| Tester delivery      | N15–N17 | Cross-device/device evidence and a compatible configured build            |

## Product decisions carried into the build

| Area             | Build rule                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation     | Remove the collapsing priority region, sticky task summary, and completion-driven scroll jumps. Keep message order, membership, and commentary stable. Resolve referenced task title/status/project/updated date live.                                                       |
| Task interaction | Checkbox changes desired status; title opens details over the conversation, with Open project. Missing/deleted references remain intelligible. Completion stays in its original reply.                                                                                       |
| History          | Start with latest 50 messages, pages of 50, and at most 150 retained messages, plus viewport virtualization. Individually virtualize task rows within large replies. Remounting older references reads current entities. These are initial tuning values.                    |
| Today            | Independent daily order and planning date; never overload global `Task.position` or task `dueDate`. At most one playable entry per linked task per day. Activities and breaks need not create backlog tasks.                                                                 |
| Day preparation  | On first opening of the local day, assemble carried commitments, the chosen opening routine, eligible open backlog, and automatic breaks. Reopening preserves manual edits. New mid-day tasks require Add to Today or explicit append/refresh.                               |
| Opening routine  | The admin example is 10 → 5 → 30 minutes, then existing queue order. Proposed carryover precedence: mindfulness/reprioritisation may precede work; tomorrow deferrals form the first work segment, ahead of the usual email block.                                           |
| Time             | Keep original estimate, revised daily allocation, actual intervals, and remaining allowance separate. Allocation expiry shows overtime and choices; it never completes a task or silently advances.                                                                          |
| Adaptation       | Extend pushes later forecasts back. Later today retains effort and moves the entry to the tail, repeatedly if needed. Tomorrow closes today's run and commits the next-day entry at the front of its work queue. Remove today leaves the task in the backlog.                |
| Breaks           | **Automatic insertion is the default**, superseding suggestion-only drafts. Initially 120 minutes of planned work and a separate proposed 5-minute break duration; both configurable, automation switchable off. Manual insert/reorder/resize/remove/skip remains available. |
| Recovery         | A long work item can cross a break threshold; offer Break now without forcing task completion. Dismissal/skip is not recorded rest. Remember manual removals so reconciliation does not immediately recreate breaks.                                                         |
| Context          | Place and mental-mode requirements are soft task metadata. Show them and make deferral easy; no location sensing or hard blocking.                                                                                                                                           |
| Player/media     | Compact dock and expanded focus view share one account-owned runtime. Scene, volume, and mute are independent of timer/status/order. Media failure leaves work controls usable.                                                                                              |

Default allocations, break settings, and carryover precedence are explicit product
choices, not productivity or health claims. The detailed plans define edge cases;
this table records the direction to implement, not evidence that it already works.

## Current implementation and evidence

Source reviewed on 2026-11-10 in the existing working tree:

| Existing foundation                                                                                                                                                                                            | Consequence for this build                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Committed app state](../../apps/mobile/src/state/atoms.ts) and [serialized local writer](../../apps/mobile/src/application/mutations.ts)                                                                      | Reuse task identity, account-generation fences, and snapshot → plan → commit → publish. Widgets do not need another entity store.                                                                              |
| [Reference rendering](../../apps/mobile/src/features/chat/RefUnfurl.tsx), [TaskThread](../../apps/mobile/src/features/chat/TaskThread.tsx), and [TaskSheet](../../apps/mobile/src/features/task/TaskSheet.tsx) | Extract/refine existing controls. Current history is mapped into a list header; current grouping and per-row pending state do not meet repeated live-block behavior. Task details currently use a pushed card. |
| [Core batch planner](../../packages/core/src/batch.ts), [events](../../packages/core/src/events.ts), [fold](../../packages/core/src/fold.ts), and [undo](../../packages/core/src/undo.ts)                      | Existing task commands and atomic journal batches are the foundation. Day stacks, allocations, time intervals, and templates are new domain work.                                                              |
| [Mobile entity cache](../../apps/mobile/src/db/entities.ts), [local database](../../apps/mobile/src/db/database.ts), and [Worker store](../../apps/worker/src/eventStore.ts)                                   | Both adapters explicitly handle existing entity kinds. New records require projection/cache/transaction support, not just new screens. Unknown kind fallback must not classify new records as tasks.           |
| [Shared sync contract](../../packages/contracts/src/sync.ts) and [turn persistence](../../apps/worker/src/agent/turn.ts)                                                                                       | Extend shared event validation compatibly. Keep existing turn identities and streams; no separate timer transport. Assistant message identity is already `msg_${turnId}_assistant`.                            |
| [Dictation](../../apps/mobile/src/features/dictation/index.ts) uses `expo-audio` and changes global audio mode                                                                                                 | Ambience must coordinate the audio session with microphone capture, rather than competing with it.                                                                                                             |
| [Storage/startup work](storage-and-dx.md) and [CI](../../.github/workflows/ci.yml)                                                                                                                             | Preserve failure gates and account data. Current web storage supports one workspace tab per origin. Target Node 24 and pnpm 11.10.0 for reproducible checks.                                                   |

The umbrella plan records historical test counts and implementation checkpoints.
They are not fresh verification of this working tree. This planning pass does not
establish native builds, two connected clients, production bindings, or player
behavior. The [Chronocat gallery](../references/chronocat/README.md) contains 18
reference captures, including expanded player and scene selection; live playback,
overtime, and drag/reorder were not verified there.

Keep Expo 58, the existing UI library and list packages, Effect 4.0.1, Alchemy
2.0.0-beta.80, and never-rest 0.7.0. A framework, database, or model-provider
migration is not a prerequisite. Keep Turso evaluation off this build's critical
path unless current-storage acceptance exposes a measured blocker.

## Boundaries and key facades

The [interface register](../internals/interfaces.md) remains the shared boundary
reference. The table below retains the original proposed layout; current schemas
and entry points are recorded in its implemented section and the ledger above.
DS3 uses core template policy through DS1/the existing writer instead of adding
another mobile writer module. Exact schemas and signatures are in the N01 exports.

| ID / facade           | Consumer → provider and proposed location                                                                                                                          | Inputs → outputs; essential contract                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 `TaskInteractions` | Task blocks/details/Today → committed store and existing writer; mobile `src/application/taskInteractions.ts`, React adapter `features/task/useTaskInteraction.ts` | Read by task ID → available/deleted/missing; set explicit desired status → committed/no-op/busy/unavailable or typed failure. Pending/error coordination is account-generation + task scoped, above individual copies.                   |
| F2 `ThreadTimeline`   | Chat screen → core selection and mobile presentation; `features/chat/useThreadTimeline.ts`, proposed `messageParts.ts`, existing core `thread.ts`                  | Window/cursor/viewport/turn state → stable message/part rows, older/newer paging and jump-to-latest. Keys include chat, message, part, occurrence; stream reconciliation uses IDs, not matching text.                                    |
| F3 `TaskNavigation`   | Reference titles/details → Expo Router; `features/task/useTaskNavigation.ts`, existing task route/root stack                                                       | Task/project identity and origin → overlay/open/close/project navigation. Preserve draft, reading position, back/focus behavior, including direct links and deleted projects.                                                            |
| F4 `ThreadCapture`    | Composer and local Show tasks → existing atomic batches; `application/threadCapture.ts`                                                                            | Capture request/submission ID → task plus system-reference receipt in one commit. Show tasks → stable reference reply, initially capped at 50 with a remaining-count explanation. Both work without an agent/network.                    |
| DS1 `DailyStack`      | Today, task Add to Today, and player queue controls → core planners/writer; `application/dailyStack.ts`, core `dailyStack.ts`                                      | Account/day/queue/explicit edits → committed stack/forecast/transfer receipt. Assemble, add, reorder, allocate, remove, and insert break; next-day transfer is one atomic batch.                                                         |
| DS2 `StackPlayer`     | Dock/focus controls → interval planner, writer, runtime ports; `application/stackPlayer.ts`, core `stackPlayer.ts`                                                 | Entry/run identities, explicit action, supplied clock → committed run state and derived elapsed/remaining/overtime. Play, pause, resume, extend, later, tomorrow, finish, and take break. Scene/media commands cannot mutate work state. |
| DS3 `StackTemplates`  | Routine picker/daily assembly → pure instantiation/reconciliation and writer; `application/stackTemplates.ts`, core `stackTemplates.ts`                            | Template version/invocation/queue/break policy → independent entries and an idempotent change set. Stable generated origins and suppression preserve manual edits.                                                                       |

These are a small set of entry points over existing subsystems, not separate
services or class hierarchies. Keep player lifetime above routes, scoped to the
active account; keep UI components functional and use the existing `src/ui`.

### Shared completion, events, and runtime ports

- **One mutation policy.** F1, DS1, DS2, task details, and Worker/agent task updates
  use the same core batch planning policy. Local linked completion resolves the
  day entry and closes its known open interval with the status change. Avoid a
  dependency cycle where F1 calls DS2 and DS2 calls F1. Their shared dependency
  is the existing command planner/writer.
- **Offline limits are explicit.** An unseen interval on another offline device
  cannot be atomically stopped by a local checkbox. N01 defines owner-side
  reconciliation, effective stop time/clock-skew handling, and overlap reporting.
  V1 disables a second start when a remote active run is known; independent
  offline runs remain visible conflicts, never silently authoritative summed time.
- **Stable entity identity differs from event identity.** Day/task/template
  origins deduplicate semantic entries. Immutable event IDs identify actual
  event payloads; two devices must not stamp different payloads with the same
  event ID. N01 must define merge behavior for concurrent day assembly, reorder,
  and transfer before UI depends on it. Retry safety alone is insufficient.
- **Additive data.** Day records retain local date and planning timezone; entries
  retain allocation, disposition, order and origin; intervals retain device and
  UTC boundaries; templates are versioned; player/break preferences are validated.
  Tomorrow is local calendar arithmetic. Time already logged stays on its source
  day; missed days do not multiply commitments into rolling debt.
- **Existing boundaries.** Core imports only Effect and its modules. Changed unary
  schemas use the same `@yatma/contracts` module from handlers/hosts/clients/tests,
  reuse Effect Standard Schema, and convert to neverthrow Result at the API edge.
  Stream frames and audio bytes remain host-owned. UI actions do not each need
  a new HTTP endpoint.
- **Small runtime ports.** Inject clock, device identity, reminder scheduler, and
  media/audio-session adapters. Persist interval boundaries, not per-second
  events. Derive display from timestamps after suspend/reload. Expo background
  jobs are deferred work, not precise timers, per [Expo 58 BackgroundTask](https://docs.expo.dev/versions/v58.0.0/sdk/background-task/).
  Local reminders are best effort and must be replaced/cancelled on edits.
- **Audio ownership.** A single app adapter coordinates ambience and dictation;
  proposed default is pause/duck ambience while recording and restore the user's
  media preference afterward. Never alter the task interval as a side effect.
  [Expo 58 Audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/) describes global
  session configuration. Verify APIs against pinned `expo-audio` 58.0.9; current
  SDK documentation recommends a newer patch, so do not assume exact parity.

Start with the existing committed context rather than adding a new state library.
Keep interaction state outside virtualized rows: React Native documents that
[off-window row state is not preserved](https://reactnative.dev/docs/virtualizedlist).
Bounded rendering does not fix the current full-journal hydration/refold cost;
measure that separately in N15 before choosing additional storage work.

## Ordered build tasks

The sequence has five checkpoints. N IDs coordinate delivery; W and DP IDs remain
the detailed work/spec references. A checkpoint is accepted through its evidence,
not by the presence of code. Dependencies below permit incremental work; they
do not authorize delegation or require parallel agents.

### Checkpoint 0 — Baseline and consequential contracts

- [x] **N00 — Record a reproducible baseline and startup path.** No prerequisites.
      Preserve and inventory the current working-tree changes; do not reset them.
      Record commit/runtime/configuration and run the existing tests, typechecks,
      boundary check, and root startup smoke under the supported Node 24 toolchain.
      Recheck storage-ready failure/recovery before any new writer is enabled.
      **Evidence:** dated baseline with actual failures separated from new regressions;
      fresh local capture survives reload and a failed hydrate does not open editing.
      Maps to storage DX0/DX1 and existing alpha gates.

- [x] **N01 — Finalize shared contracts and executable acceptance fixtures.**
      Depends on N00. Refine F1–F4/DS1–DS3, domain records/state transitions, upgrade
      gate, concurrent assembly/deferral policy, account-switch recovery, clock
      corrections, deletion while playing, and Undo semantics. Proposed Undo default:
      reopening a task never silently restarts a historical interval. Add explicit
      Gurki paths for concurrent assembly and dictation/media coordination where the
      current scenarios do not cover them; retain existing scenario IDs.
      **Evidence:** reviewed transition/merge fixtures with deterministic expected
      results and an allowed wiring list. Pin a reproducible Gurki validation tool;
      finalize coordinator-owned shared schemas/exports before dependent work.
      Maps to W0/DP0. No user decision is required to start this investigation.

### Checkpoint 1 — Ship the simpler conversation

- [x] **N02 — Build deterministic message parts and timeline selection.** Depends
      on N01. Extend core `thread.ts` and proposed mobile `messageParts.ts`/F2. Reuse
      persisted Markdown task references, validate IDs, preserve prose/bullet/numbered
      content and legacy chats, and reconcile streaming/durable messages by identity.
      **Evidence:** repeated references have unique occurrence keys; paging cursors
      are stable for equal timestamps; identical text is not treated as identical
      messages; streaming completion leaves one durable reply. Maps to W1.

- [x] **N03 — Deliver shared live task controls.** Depends on N02. Implement F1
      and extract blocks from `RefUnfurl` using committed entities and the existing
      writer. Render title/project/updated date, separate title and checkbox targets,
      and account-scoped pending/errors; no optimistic entity copies or done regroup.
      **Evidence:** five copies agree through done → todo, a failed commit, remote
      merge, deletion, and unmount/remount; one pending action cannot be raced by
      another copy. Maps to W2.

- [ ] **N04 — Replace the collapsing region with a windowed thread.** Depends
      on N03. Replace `TaskThread`'s history-in-header structure with individually
      virtualizable message/task rows. Implement the 50/50/150 window, reading anchor,
      new-message indicator and jump-to-latest, including an active turn off-window.
      Remove collapse/sticky-summary behavior when its replacement is usable.
      **Evidence:** long replies/history remain bounded, completing tasks does not
      jump/reorder history, and paging back resolves current state. Maps to W3.

- [ ] **N05 — Complete overlays, local capture, and conversation regression.**
      Depends on N04. Implement F3/F4 in existing routes, `TaskSheet`, and
      `ThreadComposer`: task detail overlay/Open project, atomic task receipt, and
      offline Show tasks. Preserve draft/back/focus plus Stop/recovery, change cards,
      whole-turn Undo and voice capture. **Evidence:** widget Gurki paths have linked
      focused tests/manual results; native/web navigation and offline capture remain
      usable after removing the old priority region. Maps to W4–W6.

**First independent delivery:** the simpler chat can ship without daily-stack
events or a storage-engine migration. Do not wait for scenes to remove the old UI.

### Checkpoint 2 — A durable daily loop

- [x] **N06 — Implement pure daily and player policy.** Depends on N01. Add the
      proposed core modules, schemas, commands/events, folds and history/Undo support
      for day, entry, interval, template and preferences. Include estimates/context,
      forecast arithmetic, retry/no-op behavior and the selected merge policy.
      **Evidence:** supplied-clock/ID tests cover extension, repeated Later, atomic
      Tomorrow planning, midnight/DST, remaining allowance, and original-vs-actual
      accounting. Exhausted requeued entries require a fresh positive allowance.
      Maps to DP1; the policy foundation for templates/breaks precedes their UI.

- [x] **N07 — Add readers and compatibility protection before new writers.**
      Depends on N06. Extend mobile/Worker journal/cache/projection handling and
      shared sync DTO validation. Define a staged old-client capability/upgrade gate
      for push, catch-up and live streams; retain existing task-event readers.
      **Evidence:** old persisted fixtures still load; unsupported clients cannot
      silently discard new events or advance cursors; supported readers work before
      any client is allowed to emit new records. Maps to DP2.

- [x] **N08 — Wire durable stack commands through the existing writers.** Depends
      on N07. Implement DS1 using local and Worker application mutation services;
      preserve account fencing, outbox and atomic projections. Include independent
      daily ordering, allocation/context edits, manual activities/breaks and next-day
      transfer. **Evidence:** injected transaction failure leaves both days, interval
      and task consistent; retries and duplicate sync do not create duplicate entries
      or time. Publish UI changes only after commit. Maps to DP2.

- [ ] **N09 — Implement the account-owned player runtime.** Depends on N08.
      Implement DS2 with play/pause/resume/extend/later/tomorrow/finish, derived clock
      display, startup/suspend reconciliation, explicit time correction and reminder
      lifecycle. Mount above screens; fence old callbacks and media on account change.
      **Evidence:** pause excludes time; reload preserves a run; clock discontinuity,
      accidental overnight run, denied reminders and failed writes have truthful
      recovery. Expiry does not complete/advance. Review Expo 58-compatible notification
      dependency/configuration before adding it. Maps to DP3.

- [x] **N10 — Join task completion and playback at the batch boundary.** Depends
      on N09/N05. Apply the shared policy to local task controls and Worker/agent
      updates. Resolve linked entries and known active intervals on completion or
      deletion; handle remote completion and offline unknown runs using N01's policy.
      Preserve explicit Undo behavior and later edits. **Evidence:** finishing in
      chat or player updates all copies and stops local recording in the same commit;
      failed completion changes neither; remote/Undo traces retain truthful time.
      Maps to F1/DS2, DP2–DP4 and existing mutation/Undo gates.

- [ ] **N11 — Deliver Today, stack editing, and the compact player.** Depends on
      N10. Proposed route: `apps/mobile/app/(tabs)/today.tsx`; keep Chat as home and
      retain Matrix/Projects/Settings. Add estimates/context, daily order, direct
      drag and accessible Move controls, Insert break, Remove today, Later/Tomorrow,
      Add to Today from details, and a dock that survives navigation.
      **Evidence:** offline end-to-end on an existing task: add → play → pause →
      reload → extend → Later twice → Tomorrow; original task/due date/global order
      survive, and tomorrow's entry is retained at the front. Maps to DP4.

**Working-loop checkpoint:** one device can plan, run, and adapt real tasks with
durable time. Use this to validate the domain before building all media polish.
It is an engineering increment; the first complete product also includes the
ready-to-play behavior in checkpoint 3.

### Checkpoint 3 — Open Today and press Start

- [x] **N12 — Add reusable routines and once-per-day inbox assembly.** Depends on
      N11. Implement DS3 save/load and DS1 assembly from eligible backlog plus explicit
      next-day commitments. Add the 10/5/30 opening, linked-email deduplication, stable
      invocation/day identities, carryover ordering and explicit mid-day append.
      **Evidence:** reopening/retrying/two-device assembly preserves a single day's
      entries and manual order; editing a routine does not rewrite previous days;
      missed days do not multiply debt. Maps to DP5 and DSP-01–04/10/13/23.

- [x] **N13 — Add automatic breaks with manual precedence.** Depends on N12.
      Materialize breaks during assembly; reconcile only future untouched generated
      entries after reorder/extension. Expose interval/duration/off settings and
      suppression-aware manual edits. Add actual-work nudges, Break now, and explicit
      return to the unfinished item. **Evidence:** open Today → Start requires no
      break checklist; no duplicates/resurrected removals/final pointless break;
      manual qualifying breaks satisfy the interval; dismiss/skip records no rest;
      a long task can resume after a break. Maps to DP6 and DSP-14–16/24–25/27.

- [ ] **N14 — Deliver expanded focus and independent media scenes.** Depends on
      N11. Proposed focus route/presentation is finalized with the existing root
      stack; the dock's expand control opens the current timer, queue and forecast.
      Provide a small owned/licensed scene catalog, visual selection, optional audio,
      mute/volume and recoverable loading failure. Coordinate the audio adapter with
      dictation; don't reuse captured Chronocat assets as product media.
      **Evidence:** scene changes during a running interval preserve actual time,
      selection/order/status; recording and interruptions restore media preference
      without changing playback; web autoplay denial leaves controls usable.
      Maps to DP4/DSP-26 and N01's added audio scenarios.

**Complete feature checkpoint:** daily inbox, routines, manual stack management,
automatic breaks, compact/expanded player, scenes, and live chat widgets work
together. Agent-driven day planning can follow; no new agent tools are required
to make this manual/local flow usable.

### Checkpoint 4 — Convergence and tester delivery

- [ ] **N15 — Accept cross-device behavior and measure retained-history costs.**
      Depends on N10/N13/N14. Exercise two connected clients plus offline divergence:
      concurrent assembly/reorder/deferral, known remote run, independently started
      runs, completion while disconnected, reconnect and duplicate delivery. Profile
      large conversations, a large single reply, and growing day/interval history.
      **Evidence:** convergence/conflict results match N01; overlaps remain visible;
      account switching leaks no task/player/reminder state. Record render and
      hydrate/refold timings separately and resolve measured blockers before release.
      Maps to DP7/W6 and the alpha two-device gate.

- [ ] **N16 — Close native, storage, and existing alpha acceptance gates.** Depends
      on N15. Run actual Expo SQLite and Cloudflare DO/SQLite restart/FTS checks,
      native/web startup recovery, iPhone/Android sign-in isolation, offline sync,
      stopped/background agent recovery, Undo after later edits, dictation, notifications
      and audio interruptions. Configure real auth/model/audio/EAS/App Store identifiers
      through existing deployment setup. **Evidence:** dated device/build/runtime
      results with failures fixed or explicitly remaining; an export or unit test
      does not substitute for these gates. Maps to the outstanding private-alpha work.

- [ ] **N17 — Record acceptance and roll out compatible tester builds.** Depends
      on N16. Run final regression/contract/type/boundary checks, publish the evidence
      matrix, update product/interface/plan status, and produce a configured tester
      build. Verify server readers and client capability enforcement before enabling
      new writers; retain read support if feature controls are disabled.
      **Evidence:** the build-outcome demonstration passes on recorded builds,
      unsupported-client recovery is understandable, unsent events survive recovery,
      and the private-alpha checklist reflects actual acceptance. Maps to DP7/W6 and
      release configuration. No history purge or destructive rollback.

## Gurki acceptance and validation

The canonical target contracts are:

| Spec                                                          | Current scenarios                      | Primary build mapping                                          |
| ------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| [Thread task widgets](../specs/thread-task-widgets.spec.md)   | 43 explicit paths across WTW-01–WTW-26 | N02–N05; repeated state/navigation regression again at N10/N15 |
| [Daily stack and player](../specs/daily-stack-player.spec.md) | 29 explicit paths, DSP-01–DSP-29       | N06–N15; native/runtime acceptance at N16                      |

These **72 target scenarios are not 72 passing application tests**. N01 adds
missing consequential paths without renumbering existing ones. Keep `.spec.md`
canonical, with Given/When/Then/Output/Outcome/Activates as appropriate. Generated
IR/reports and Gurki lint validate the document model, not the app. Use
scenario-named existing Vitest-style tests and dated manual device results for
behavioral evidence; no new BDD execution framework is required.

The source-pinned Gurki CLI previously used for these files declares v0.1.0 at
commit `d1b1f7fad53fc5c880a23faccd9007cdce7fa250`. N01 should make that validation
reproducible through the coordinator-owned tooling/catalog workflow rather than
assuming an unverified npm package. The [upstream language contract](https://github.com/danalexilewis/gurki/blob/d1b1f7fad53fc5c880a23faccd9007cdce7fa250/docs/spec.md)
defines the authored/derived distinction; the public
[Gurki specification](https://gurki.nz/spec) is the entry point.

At N00 and N17 use the repository's existing checks under Node 24:

```sh
pnpm test
pnpm -r typecheck
pnpm check:boundaries
```

During implementation run checks appropriate to each change, widening to the
shared contract/persistence suite when shared schemas or event handling changes.
Use injected clocks/IDs, replay and forced transaction failures for domain/time
checks. Use actual builds for background, audio, notification and storage behavior.
Do not add tests that merely mirror a low-impact UI change.

Evidence should record scenario ID, build/commit, environment/device, result,
and a test path or capture/log reference. Mark target, implemented, and verified
separately. Record any intentionally blocked gate instead of counting it as passed.

Documentation checks on 2026-11-10: both existing Gurki specs lint with zero
errors/warnings; all 72 local links across the five connected planning/interface
documents resolve; N00–N17 IDs and prerequisite order are consistent. That planning review predates the application verification in the execution ledger;
physical-device acceptance remains unverified.

## Risks and mitigation tasks

Ratings are planning judgments, not measured probabilities. Mitigations below
remain work until their evidence exists.

| Risk                                                                                            | Likelihood          | Impact                                 | Mitigation and task                                                                                                 | Remaining concern                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| New events reach an older client, fail decoding, and disappear behind an advanced cursor        | High without a gate | High: lost visible history/convergence | N01 compatibility contract; N07 reader-first rollout/cursor fixtures; N17 staged enablement                         | Old offline builds may return after rollout; gate must cover catch-up/live as well as push. |
| Two devices assemble/defer/reorder the same day and create duplicates or overwrite manual order | Medium              | High: untrustworthy daily plan         | N01 semantic identity/merge policy; N06 deterministic tests; N08 transactions; N12/N15 two-client cases             | Stable retry IDs alone do not define concurrent merge behavior.                             |
| Widget completion and run-stop take different paths, or an unseen offline run keeps recording   | Medium              | High: inconsistent status/time         | N01 stop/Undo/clock policy; N10 common batch planner; N15 remote/offline evidence                                   | Offline global exclusivity is unavailable; preserve and explain unresolved overlap.         |
| Suspend, clock jumps, repeated taps or reminder callbacks fabricate elapsed work                | Medium              | High: incorrect time history           | N06 interval identities; N09 timestamp recovery/corrections and reminder replacement; N16 device tests              | A person may leave a run on accidentally; correction stays explicit.                        |
| Automatic break reconciliation overwrites manual edits or recreates skipped breaks              | Medium              | Medium: intrusive/unusable stack       | N01 origin/suppression contract; N13 future-only reconciliation and scenario fixtures                               | Boundary identity after complex reorder needs concrete fixtures.                            |
| Ambient playback competes with dictation or media failure disrupts work controls                | Medium              | Medium: lost capture or unusable focus | N09 runtime isolation; N14 shared audio-session adapter and failure fallback; N16 interruption tests                | Platform/native patch behavior needs physical-device evidence.                              |
| Bounded UI hides growing full-journal hydrate/refold cost; existing startup failures recur      | Medium              | High: startup/write stalls             | N00 startup gate; N04 true row virtualization; N15 separate storage/render measurements; N16 persistence acceptance | Storage optimization may become necessary; a Turso migration is not presumed to solve it.   |
| Broad existing uncommitted work is confused with this build's changes or historical test claims | High                | Medium: unreliable handoff             | N00 baseline inventory; stable task IDs and per-checkpoint evidence; N17 status reconciliation                      | Keep root manifests, shared exports/contracts, and composition changes coordinator-owned.   |

## Delivery boundaries and open decisions

No product clarification blocks starting N00/N01. Before new day writers are
implemented, N01 must settle exact schemas, concurrent merge/ordering semantics,
remote effective-stop/correction behavior, account-switch run recovery, and
capability negotiation. These are engineering decisions with fixture evidence,
not assumptions that existing task sync automatically provides them.

Use the proposed defaults unless implementation evidence requires a documented
change: 120-minute work interval, 5-minute break, explicit Next/Finish advancement,
preparation rituals before carried work, and no silent restart on Undo. Choose a
clearly labelled default task allowance and initial licensed scene set during the
relevant build task; the user has not specified those values/assets. Keep planned
timezone stable within an existing day; travel changes future planning deliberately.

Keep current readers available after new data exists. Turning off a feature's
writers/UI cannot make its stored events unreadable. Recovery preserves local
outbox/account data; do not use journal deletion as rollout or startup repair.
If acceptance reveals a current-storage blocker, record the measurement and
revisit the [storage evaluation](storage-and-dx.md) before widening scope.

Outside this build: calendar scheduling/integrations, a general recurrence engine,
GPS/context detection, automatic missed-day debt, smart estimates, a media
marketplace/external playlist platform, online device takeover, and a storage
engine migration. Saved routines plus daily opening are included; a general
calendar recurrence system is not required for them.

The local feature implementation is now in place. The next delivery work is
**N15–N17 external acceptance**, plus the explicitly unverified native/navigation
checks in the execution ledger. Unchecked items above retain unmet acceptance
criteria even where the implementation already exists.

## Consulted references

Accessed/reviewed 2026-11-10:

- Repository source and the linked feature, storage, interface and alpha plans:
  current implementation boundaries and outstanding acceptance.
- [Chronocat reference gallery](../references/chronocat/README.md): observed
  dock/focus/routine/scene presentation, with explicit interaction limits.
- [Gurki language](https://gurki.nz/spec) and its pinned upstream source:
  canonical Markdown, closed keywords, and derived reports. The website failed
  through the web reader; the pinned source was read directly instead.
- [React Native VirtualizedList](https://reactnative.dev/docs/virtualizedlist):
  finite render windows and external ownership of durable interaction state.
- [Expo 58 Audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/): global audio
  session/mode and native configuration; check the installed patch's APIs.
- [Expo 58 BackgroundTask](https://docs.expo.dev/versions/v58.0.0/sdk/background-task/):
  deferred OS-controlled scheduling, supporting timestamp-derived timer design.

The facade grouping, checkpoint order, default precedence and qualitative risks
are design judgments for Yatma, informed by the repository and user direction.

## Standalone task catalog follow-up — 2026-11-11

Implemented: Tasks and Routines have workspace/sidebar and mobile tab destinations.
Tasks includes unassigned and project tasks, search, status/project/date filters,
priority/title/due-date/recent-update sorting, multi-select project assignment and
Add to Today. Projects open at their scoped catalog; overview remains available.
Today links to the catalog and routines instead of hiding those features inline.

Verified on Node 24: 20 tests across taskCatalog, mutations and dailyStack pass;
workspace typechecks and package boundaries pass. Browser checks on the isolated
local preview cover standalone task creation, project assignment, project task
navigation, removal from a project, persistence after reload, No project filtering
and the Routines destination. Native device acceptance has not been run.

Future sharing is explicitly design-only per user direction. The boundary and
remaining authorization/storage decisions are recorded in interfaces.md; no
invitation or cross-account access capability is claimed.

### Task toolbar refinement — 2026-11-11

Replaced the stacked catalog controls with a fixed, single-row toolbar: status
menu and count, search, Filter, Sort and Add task. Filter/sort choices use anchored
menus on desktop and bounded sheets on narrow layouts. Active filters show a
count; selection replaces the toolbar with bulk project assignment. Add task
opens an inline composer above the list. Text controls do not repeat tooltips.

Verified: mobile package typecheck, three catalog tests and diff whitespace checks
pass. Browser checks at 1280px and 390px cover filtering unassigned tasks, sort
selection, contextual bulk assignment, and opening/cancelling task creation.
Native device acceptance remains separate.

### Task dialog and mobile navigation refinement — 2026-11-11

Implemented bordered, padded task inputs with visible labels and primary text
contrast. Status/project choices use consistent 44pt rectangular controls.
Discuss, Add to Today and Delete now occupy the fixed dialog header beside Close;
icon-only actions retain concise tooltips. Mobile tabs are Conversations, Today,
Tasks and More; Projects, Routines, Focus mode and Settings are linked from More.
Desktop workspace navigation stays available.

Verified: mobile typecheck and diff checks pass. Browser checks at 390px confirm
readable dialog fields without horizontal overflow, header close, the reduced tab
bar and More destinations. Link-click verification was interrupted by preview
automation failures; native device testing remains open.

### Description and task todos — 2026-11-11

Implemented: Notes is labelled Description without migrating existing text.
Task detail contains text-only Todos with checkboxes, plus-to-add, edit/remove,
and Enter-to-save-and-add-another. No child task entities are created. Checklist
saves use existing task commands, journal projections and field-aware Undo;
failed saves retain the editor and show an error. Empty drafts are not persisted.

Verified: 169 tests across core, contracts, mobile mutation/SQLite/sync and Worker
HTTP pass; all workspace typechecks, package boundaries and diff checks pass.
Regression tests cover create/update, no-ops, replay, SQLite/cache hydration,
blank rejection, failed commit and Undo. Browser Enter saved an item and focused
the next editor. Native keyboard/device acceptance remains unverified.

Compatibility: reader capability 4 requires matching Worker deployment before
new clients; no deployment was performed. See interfaces.md for the schema and
whole-checklist concurrency semantics.

### Priority and schedule/deadline separation — 2026-11-11

Implemented Priority dropdown and Today/This week/Next week/Later schedule presets,
plus explicit scheduled-date editing and a separate optional deadline. Removed
Place/Mental mode from task detail and planning context. The task catalog displays
both dates distinctly, filters schedule windows and sorts by schedule or combined
priority/deadline policy. Today stack ordering remains manually controlled.

Verified: 173 tests across core/contracts, local mutation/SQLite/sync and Worker
HTTP pass; workspace typechecks pass. Added coverage for week/year boundaries,
priority/deadline ordering, schedule filtering, independent field persistence,
invalid dates and Undo without altering deadlines. Browser at 390px confirms the
priority dropdown and selection and both independent date inputs. No native-device
acceptance or deployment is claimed; sync requires matching capability-5 readers.

### Today scheduling toggle — 2026-11-11

Implemented atomic Add to Today + scheduled-date update through the existing daily
writer. Task dialog/catalog buttons toggle to Unschedule; scheduled-date Clear,
Later and moving the schedule away from today remove pending Today entries in the
same batch. Removing a task from Today clears its matching schedule. Recorded work
and deadlines remain intact. Due date quick choices are disabled in task detail.

Verified: 32 daily/mutation/player tests pass, covering failure rollback, active
interval closure/history preservation, reload, idempotent add and re-add after
unscheduling. Mobile typecheck passes. Browser confirms the toggle, clear action
and absence of deadline quick choices; native acceptance remains separate.

### Single source for Today membership — 2026-11-11

Implemented schedule-derived membership in shared core planning, including task
create/update, day opening, daily add/remove and Tomorrow transfers. Removed the
mobile addTask facade and caller-side removal construction. Scheduling today and
the Today shortcut now invoke the same schedule operation. Entries preserve
execution state while the scheduled date controls inclusion. No schema change.

Verified: 172 tests across core, daily/mutation/player application and Worker daily
planning pass (171-test run plus the new day-opening regression). Workspace
typechecks pass. Regressions cover direct schedule edits, opening a pre-scheduled
day, preserving allocations on rescheduling, unscheduling/removal, recorded work,
Tomorrow transfers and offline convergence. Native/device acceptance is separate.


## Commit verification — 2026-11-16

The outstanding daily planning, focus/player, task catalog, conversation review,
and Gmail intake implementation was checked together on Node 24.22.3.
All 375 tests in 63 files pass, along with repository typechecks, package boundary
checks, spec lint, and whitespace checks. The local linked-review decision now
checks the task version before the same batch stages its scheduling update;
the Today hover regression exercises real animation timing rather than RN Web's
instant test animation mock. Native notifications/audio, authenticated Gmail,
Cloudflare deployment and two-device acceptance still require their external
runtime checks; these local results do not close those gates.
