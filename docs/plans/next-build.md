# Yatma next build: conversation and a day ready to play

Planning date: 2026-11-10. Status: proposed implementation sequence; not an
implementation or acceptance report.

This is the next-build sequence under the [private-alpha delivery plan](private-alpha.md).
It consolidates the [thread-widget design](thread-task-widgets.md),
[daily stack/player design](daily-stack-player.md), and existing startup,
sync, and device acceptance work. Those designs retain their facade and task
IDs; this document orders the work across them. The private-alpha plan remains
the release gate. No implementation task below is complete because this plan exists.

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

| Checkpoint | Tasks | Reviewable result |
| --- | --- | --- |
| Foundation | N00–N01 | Reproducible baseline and explicit domain/compatibility contracts |
| Simpler conversation | N02–N05 | Live task blocks, bounded history, overlays, and offline capture receipts |
| Durable daily loop | N06–N11 | Today with real tasks, actual time, editing, and flexible deferral |
| Ready to play | N12–N14 | Daily assembly, routines, automatic breaks, expanded player, and scenes |
| Tester delivery | N15–N17 | Cross-device/device evidence and a compatible configured build |

## Product decisions carried into the build

| Area | Build rule |
| --- | --- |
| Conversation | Remove the collapsing priority region, sticky task summary, and completion-driven scroll jumps. Keep message order, membership, and commentary stable. Resolve referenced task title/status/project/updated date live. |
| Task interaction | Checkbox changes desired status; title opens details over the conversation, with Open project. Missing/deleted references remain intelligible. Completion stays in its original reply. |
| History | Start with latest 50 messages, pages of 50, and at most 150 retained messages, plus viewport virtualization. Individually virtualize task rows within large replies. Remounting older references reads current entities. These are initial tuning values. |
| Today | Independent daily order and planning date; never overload global `Task.position` or task `dueDate`. At most one playable entry per linked task per day. Activities and breaks need not create backlog tasks. |
| Day preparation | On first opening of the local day, assemble carried commitments, the chosen opening routine, eligible open backlog, and automatic breaks. Reopening preserves manual edits. New mid-day tasks require Add to Today or explicit append/refresh. |
| Opening routine | The admin example is 10 → 5 → 30 minutes, then existing queue order. Proposed carryover precedence: mindfulness/reprioritisation may precede work; tomorrow deferrals form the first work segment, ahead of the usual email block. |
| Time | Keep original estimate, revised daily allocation, actual intervals, and remaining allowance separate. Allocation expiry shows overtime and choices; it never completes a task or silently advances. |
| Adaptation | Extend pushes later forecasts back. Later today retains effort and moves the entry to the tail, repeatedly if needed. Tomorrow closes today's run and commits the next-day entry at the front of its work queue. Remove today leaves the task in the backlog. |
| Breaks | **Automatic insertion is the default**, superseding suggestion-only drafts. Initially 120 minutes of planned work and a separate proposed 5-minute break duration; both configurable, automation switchable off. Manual insert/reorder/resize/remove/skip remains available. |
| Recovery | A long work item can cross a break threshold; offer Break now without forcing task completion. Dismissal/skip is not recorded rest. Remember manual removals so reconciliation does not immediately recreate breaks. |
| Context | Place and mental-mode requirements are soft task metadata. Show them and make deferral easy; no location sensing or hard blocking. |
| Player/media | Compact dock and expanded focus view share one account-owned runtime. Scene, volume, and mute are independent of timer/status/order. Media failure leaves work controls usable. |

Default allocations, break settings, and carryover precedence are explicit product
choices, not productivity or health claims. The detailed plans define edge cases;
this table records the direction to implement, not evidence that it already works.

## Current implementation and evidence

Source reviewed on 2026-11-10 in the existing working tree:

| Existing foundation | Consequence for this build |
| --- | --- |
| [Committed app state](../../apps/mobile/src/state/atoms.ts) and [serialized local writer](../../apps/mobile/src/application/mutations.ts) | Reuse task identity, account-generation fences, and snapshot → plan → commit → publish. Widgets do not need another entity store. |
| [Reference rendering](../../apps/mobile/src/features/chat/RefUnfurl.tsx), [TaskThread](../../apps/mobile/src/features/chat/TaskThread.tsx), and [TaskSheet](../../apps/mobile/src/features/task/TaskSheet.tsx) | Extract/refine existing controls. Current history is mapped into a list header; current grouping and per-row pending state do not meet repeated live-block behavior. Task details currently use a pushed card. |
| [Core batch planner](../../packages/core/src/batch.ts), [events](../../packages/core/src/events.ts), [fold](../../packages/core/src/fold.ts), and [undo](../../packages/core/src/undo.ts) | Existing task commands and atomic journal batches are the foundation. Day stacks, allocations, time intervals, and templates are new domain work. |
| [Mobile entity cache](../../apps/mobile/src/db/entities.ts), [local database](../../apps/mobile/src/db/database.ts), and [Worker store](../../apps/worker/src/eventStore.ts) | Both adapters explicitly handle existing entity kinds. New records require projection/cache/transaction support, not just new screens. Unknown kind fallback must not classify new records as tasks. |
| [Shared sync contract](../../packages/contracts/src/sync.ts) and [turn persistence](../../apps/worker/src/agent/turn.ts) | Extend shared event validation compatibly. Keep existing turn identities and streams; no separate timer transport. Assistant message identity is already `msg_${turnId}_assistant`. |
| [Dictation](../../apps/mobile/src/features/dictation/index.ts) uses `expo-audio` and changes global audio mode | Ambience must coordinate the audio session with microphone capture, rather than competing with it. |
| [Storage/startup work](storage-and-dx.md) and [CI](../../.github/workflows/ci.yml) | Preserve failure gates and account data. Current web storage supports one workspace tab per origin. Target Node 24 and pnpm 11.10.0 for reproducible checks. |

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
reference. Names/paths below are proposed, except the explicitly linked existing
writer/planner. Exact schemas and signatures are N01 deliverables.

| ID / facade | Consumer → provider and proposed location | Inputs → outputs; essential contract |
| --- | --- | --- |
| F1 `TaskInteractions` | Task blocks/details/Today → committed store and existing writer; mobile `src/application/taskInteractions.ts`, React adapter `features/task/useTaskInteraction.ts` | Read by task ID → available/deleted/missing; set explicit desired status → committed/no-op/busy/unavailable or typed failure. Pending/error coordination is account-generation + task scoped, above individual copies. |
| F2 `ThreadTimeline` | Chat screen → core selection and mobile presentation; `features/chat/useThreadTimeline.ts`, proposed `messageParts.ts`, existing core `thread.ts` | Window/cursor/viewport/turn state → stable message/part rows, older/newer paging and jump-to-latest. Keys include chat, message, part, occurrence; stream reconciliation uses IDs, not matching text. |
| F3 `TaskNavigation` | Reference titles/details → Expo Router; `features/task/useTaskNavigation.ts`, existing task route/root stack | Task/project identity and origin → overlay/open/close/project navigation. Preserve draft, reading position, back/focus behavior, including direct links and deleted projects. |
| F4 `ThreadCapture` | Composer and local Show tasks → existing atomic batches; `application/threadCapture.ts` | Capture request/submission ID → task plus system-reference receipt in one commit. Show tasks → stable reference reply, initially capped at 50 with a remaining-count explanation. Both work without an agent/network. |
| DS1 `DailyStack` | Today, task Add to Today, and player queue controls → core planners/writer; `application/dailyStack.ts`, core `dailyStack.ts` | Account/day/queue/explicit edits → committed stack/forecast/transfer receipt. Assemble, add, reorder, allocate, remove, and insert break; next-day transfer is one atomic batch. |
| DS2 `StackPlayer` | Dock/focus controls → interval planner, writer, runtime ports; `application/stackPlayer.ts`, core `stackPlayer.ts` | Entry/run identities, explicit action, supplied clock → committed run state and derived elapsed/remaining/overtime. Play, pause, resume, extend, later, tomorrow, finish, and take break. Scene/media commands cannot mutate work state. |
| DS3 `StackTemplates` | Routine picker/daily assembly → pure instantiation/reconciliation and writer; `application/stackTemplates.ts`, core `stackTemplates.ts` | Template version/invocation/queue/break policy → independent entries and an idempotent change set. Stable generated origins and suppression preserve manual edits. |

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

- [ ] **N00 — Record a reproducible baseline and startup path.** No prerequisites.
  Preserve and inventory the current working-tree changes; do not reset them.
  Record commit/runtime/configuration and run the existing tests, typechecks,
  boundary check, and root startup smoke under the supported Node 24 toolchain.
  Recheck storage-ready failure/recovery before any new writer is enabled.
  **Evidence:** dated baseline with actual failures separated from new regressions;
  fresh local capture survives reload and a failed hydrate does not open editing.
  Maps to storage DX0/DX1 and existing alpha gates.

- [ ] **N01 — Finalize shared contracts and executable acceptance fixtures.**
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

- [ ] **N02 — Build deterministic message parts and timeline selection.** Depends
  on N01. Extend core `thread.ts` and proposed mobile `messageParts.ts`/F2. Reuse
  persisted Markdown task references, validate IDs, preserve prose/bullet/numbered
  content and legacy chats, and reconcile streaming/durable messages by identity.
  **Evidence:** repeated references have unique occurrence keys; paging cursors
  are stable for equal timestamps; identical text is not treated as identical
  messages; streaming completion leaves one durable reply. Maps to W1.

- [ ] **N03 — Deliver shared live task controls.** Depends on N02. Implement F1
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

- [ ] **N06 — Implement pure daily and player policy.** Depends on N01. Add the
  proposed core modules, schemas, commands/events, folds and history/Undo support
  for day, entry, interval, template and preferences. Include estimates/context,
  forecast arithmetic, retry/no-op behavior and the selected merge policy.
  **Evidence:** supplied-clock/ID tests cover extension, repeated Later, atomic
  Tomorrow planning, midnight/DST, remaining allowance, and original-vs-actual
  accounting. Exhausted requeued entries require a fresh positive allowance.
  Maps to DP1; the policy foundation for templates/breaks precedes their UI.

- [ ] **N07 — Add readers and compatibility protection before new writers.**
  Depends on N06. Extend mobile/Worker journal/cache/projection handling and
  shared sync DTO validation. Define a staged old-client capability/upgrade gate
  for push, catch-up and live streams; retain existing task-event readers.
  **Evidence:** old persisted fixtures still load; unsupported clients cannot
  silently discard new events or advance cursors; supported readers work before
  any client is allowed to emit new records. Maps to DP2.

- [ ] **N08 — Wire durable stack commands through the existing writers.** Depends
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

- [ ] **N10 — Join task completion and playback at the batch boundary.** Depends
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

- [ ] **N12 — Add reusable routines and once-per-day inbox assembly.** Depends on
  N11. Implement DS3 save/load and DS1 assembly from eligible backlog plus explicit
  next-day commitments. Add the 10/5/30 opening, linked-email deduplication, stable
  invocation/day identities, carryover ordering and explicit mid-day append.
  **Evidence:** reopening/retrying/two-device assembly preserves a single day's
  entries and manual order; editing a routine does not rewrite previous days;
  missed days do not multiply debt. Maps to DP5 and DSP-01–04/10/13/23.

- [ ] **N13 — Add automatic breaks with manual precedence.** Depends on N12.
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

| Spec | Current scenarios | Primary build mapping |
| --- | --- | --- |
| [Thread task widgets](../specs/thread-task-widgets.spec.md) | 43 explicit paths across WTW-01–WTW-26 | N02–N05; repeated state/navigation regression again at N10/N15 |
| [Daily stack and player](../specs/daily-stack-player.spec.md) | 27 explicit paths, DSP-01–DSP-27 | N06–N15; native/runtime acceptance at N16 |

These **70 target scenarios are not 70 passing application tests**. N01 adds
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
documents resolve; N00–N17 IDs and prerequisite order are consistent. Application
regression tests and device acceptance were not rerun for this planning update.

## Risks and mitigation tasks

Ratings are planning judgments, not measured probabilities. Mitigations below
remain work until their evidence exists.

| Risk | Likelihood | Impact | Mitigation and task | Remaining concern |
| --- | --- | --- | --- | --- |
| New events reach an older client, fail decoding, and disappear behind an advanced cursor | High without a gate | High: lost visible history/convergence | N01 compatibility contract; N07 reader-first rollout/cursor fixtures; N17 staged enablement | Old offline builds may return after rollout; gate must cover catch-up/live as well as push. |
| Two devices assemble/defer/reorder the same day and create duplicates or overwrite manual order | Medium | High: untrustworthy daily plan | N01 semantic identity/merge policy; N06 deterministic tests; N08 transactions; N12/N15 two-client cases | Stable retry IDs alone do not define concurrent merge behavior. |
| Widget completion and run-stop take different paths, or an unseen offline run keeps recording | Medium | High: inconsistent status/time | N01 stop/Undo/clock policy; N10 common batch planner; N15 remote/offline evidence | Offline global exclusivity is unavailable; preserve and explain unresolved overlap. |
| Suspend, clock jumps, repeated taps or reminder callbacks fabricate elapsed work | Medium | High: incorrect time history | N06 interval identities; N09 timestamp recovery/corrections and reminder replacement; N16 device tests | A person may leave a run on accidentally; correction stays explicit. |
| Automatic break reconciliation overwrites manual edits or recreates skipped breaks | Medium | Medium: intrusive/unusable stack | N01 origin/suppression contract; N13 future-only reconciliation and scenario fixtures | Boundary identity after complex reorder needs concrete fixtures. |
| Ambient playback competes with dictation or media failure disrupts work controls | Medium | Medium: lost capture or unusable focus | N09 runtime isolation; N14 shared audio-session adapter and failure fallback; N16 interruption tests | Platform/native patch behavior needs physical-device evidence. |
| Bounded UI hides growing full-journal hydrate/refold cost; existing startup failures recur | Medium | High: startup/write stalls | N00 startup gate; N04 true row virtualization; N15 separate storage/render measurements; N16 persistence acceptance | Storage optimization may become necessary; a Turso migration is not presumed to solve it. |
| Broad existing uncommitted work is confused with this build's changes or historical test claims | High | Medium: unreliable handoff | N00 baseline inventory; stable task IDs and per-checkpoint evidence; N17 status reconciliation | Keep root manifests, shared exports/contracts, and composition changes coordinator-owned. |

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

The immediate implementation entry point is **N00, then N01**, followed by the
chat checkpoint. Do not start with a new global state store, a generic widget
framework, or media integrations: the existing domain and writer should carry
the first visible improvement.

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
