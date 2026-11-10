# Daily stack and task player

Planning date: 2026-11-10. Status: proposed; no implementation or device acceptance.
Extends the [private-alpha plan](private-alpha.md) and
[thread-widget plan](thread-task-widgets.md). Acceptance model:
[Gurki daily-stack specs](../specs/daily-stack-player.spec.md).

Cross-feature execution order is in the [next-build plan](next-build.md),
especially N01 and N06–N17. DP0–DP7 below retain the detailed feature references;
the next-build plan splits them into durable-loop and ready-to-play checkpoints.

## Outcome and product rules

Plan a realistic sequence for today, press Play, and work through it with small
recovery breaks. Time allocations help adapt the day; exceeding one is not a
failure and never completes a task automatically. A daily stack is a plan over
durable tasks, not another global task-status system.

Latest refinement: Today is an inbox assembled for each day, ready to play with
automatic breaks. This supersedes the earlier suggestion-only break default.

The user's admin-day opening is:

| Order | Block | Allocation | Meaning |
| --- | --- | --- | --- |
| 1 | Mindfulness | 10 minutes | Preparation/recovery activity |
| 2 | Reprioritise | 5 minutes | Planning activity |
| 3 | Clear email | 30 minutes | First work item |
| 4 onward | Remaining tasks | Editable per-task allocations | Preserve their existing order |

The opening is the template; the rest of the day comes from the selected task
queue. It does not need a separately scripted schedule. Do not infer a fixed
clock start time, a medical break prescription, or the rest of an admin-day routine.

- **Today has its own order.** Seed selected work from existing global task order,
  then allow daily reordering without rewriting `Task.position`. Loading an
  opening template preserves the relative order of the remaining queue. Apply it
  once per chosen invocation, not once per render or app launch.
- **Ready when the day opens.** Assemble today's inbox once from explicit
  next-day deferrals, the chosen opening template, and eligible open backlog
  tasks in their existing order. Exclude completed/deleted work and tasks explicitly
  planned for a later day. Reuse a task's allocation or a clearly identified
  configurable default. Reopening Today must not duplicate tasks or reset manual
  order. New work arriving mid-day stays in the backlog until Add to Today or an
  explicit refresh appends it; it must not reshuffle work already underway.
- **Play records actual time.** One active item on the playback device; Pause
  closes its running interval. Resume opens another interval. Actual time is the
  sum of intervals, independently of estimates. Work, preparation, and breaks
  remain distinguishable in the history.
- **Expiry is a nudge.** Continue showing elapsed/overtime. Offer Extend, Later
  today, Tomorrow, Pause, and completion. Do not silently mark done or advance
  because an estimate reached zero. Completing an item explicitly can start the
  next item; automatic advancement on expiry is outside the first delivery.
- **Extend shifts the forecast.** Adding 10 minutes increases the active item's
  revised allocation by 10 and pushes subsequent expected times by 10. Keep the
  original estimate and actual time. Do not shorten another item or erase breaks.
- **Later today keeps the task open.** Close any running interval, move its entry
  to the bottom, and retain time already spent and any unspent allocation. If the
  allowance is exhausted, request a fresh positive allowance before its next run.
  The same action is available again when it comes around.
- **Tomorrow clears today's commitment.** Atomically close the current interval,
  remove the entry from today's playable queue, and place it at the front of
  tomorrow's work queue. Preserve the task, project, due date, context, and logged
  time. Multiple deferrals form a stable front segment in deferral order; retrying
  does not duplicate them. This changes planned work date, not task due date.
- **Removing is separate.** Remove from today leaves the durable task available
  in the backlog with no automatic tomorrow commitment. Tomorrow is the obvious
  defer action. Neither operation counts as task completion or failure.
- **Context is useful information.** A task may require a place or mental mode,
  such as Office or Deep focus. Show these requirements and allow postponement
  when the context is wrong. No GPS, automatic context detection, or hard blocking
  is needed. Do not reuse legacy project-migration tags for this metadata.
- **Completion has two meanings.** Finish task on a linked task updates shared
  `Task.status` and the stack entry in one batch. Finishing an unlinked activity
  or break only finishes that day's block. A task completed in chat while playing
  closes its active interval and resolves its entry through the same application
  policy; it must not continue recording time invisibly.

## Automatic breaks, manual stack edits, and templates

Automatically insert a micro break every **120 minutes of planned work** by
default, configurable and switchable off. Break duration is a separate setting;
propose 5 minutes initially. This is the user's latest direction: open the daily
inbox, press Start, and get on with the work. These defaults are product choices,
not claims about optimal health or productivity.

Build real break entries near task boundaries while assembling the day, without
a separate acceptance dialog. Preserve the relative order and allocations of
work items; include breaks in the projected finish time. Reconcile only future,
untouched generated breaks after reorder/extension: never reset the active run,
move completed breaks, or overwrite a person's manual break edits. Generated
entries carry stable origin/boundary identities so rebuilds and sync retries do
not multiply them. A manual qualifying break satisfies the corresponding interval.
Do not append a pointless break after the last work item.

Reordering tasks, inserting a break at any position, changing its duration, and
removing/skipping a break are ordinary stack actions. Manual edits take precedence
over automation. Remember removal/suppression for the affected boundary so an
automatic refresh does not immediately put the break back. No Play-time checklist
or confirmation is required. A suggestion-only mode may be added later; automatic
insertion is the initial default.

During playback, use recorded active work rather than estimates to decide when
another suggestion is due. Reprioritisation counts as planning work; mindfulness
and break blocks are recovery time. Pauses do not add work time. A completed
qualifying break resets the work accumulator; defer/skip or a dismissed suggestion
does not pretend rest occurred. Dismiss a particular threshold once and offer
the next at the next interval, rather than nagging on every render. The person
can configure the interval or turn suggestions off.

Planned insertion is initially at task boundaries, so a single long task may
cross the interval. Its actual-work nudge offers Break now while keeping that
task open. Automatic planning does not silently stop a task at the threshold.

Taking an accepted break during a long task closes the work interval, starts a
break block, and retains a resume pointer to the unfinished task. Finishing the
break resumes that work only on the person's explicit Next/Play action. A prompt
or notification does not count as elapsed break time. First delivery does not
need to split a task into new global tasks to accommodate a break.

Templates store ordered activity definitions, allocations, and optional task
references. Mindfulness and reprioritisation do not create backlog tasks. Clear
email can be a reusable daily work activity, or explicitly link to an existing
email task; a link must not also duplicate that task in the appended queue.
Loading produces independent daily entries, so changing today's allowance does
not rewrite the template or yesterday's plan. No automatic recurring calendar
generation or template marketplace is needed.

Daily assembly runs when Today is opened or explicitly refreshed, with a stable
account/day identity. A selected default opening template can be applied as part
of that assembly; it does not need a nightly background job. Missed days do not
create an endless chain of rolled-over debt. This is automatic daily preparation,
not automatic timer start or a recurring-task calendar engine.

## Focus view and media scenes

Keep both the compact dock and an expanded player. The expanded view exposes the
current timer, remaining queue, estimated finish, and the same stack actions.
Add a scene chooser for a quiet background and optional ambient media. Store the
scene preference independently from task/run state: changing scene, volume, or
muting must not pause, reset, reorder, or complete work. Media failure leaves
the timer and manual controls usable. Choose the initial app-owned/licensed media
set during implementation; Chronocat screenshots are references, not Yatma assets.
External playlist services and a content marketplace are not required for v1.

Tomorrow deferrals occupy the front of the **work queue**. An explicitly loaded
opening routine can precede that queue; its normal email block follows carried
work unless the person explicitly reorders it. On a day without carryover, the
example runs exactly 10 → 5 → 30 minutes, followed by existing task order. This
precedence is a proposed default to reconcile opening rituals with next-day priority.

## Existing implementation and required data

Source review found no daily-stack, allocation, interval, or template model in
[task schemas](../../packages/core/src/schemas.ts) or
[events](../../packages/core/src/events.ts). `Task.position` is global priority;
`dueDate` is a due date. Neither should be overloaded with today's stack order/date.
The [tab layout](../../apps/mobile/app/(tabs)/_layout.tsx) currently exposes Chat,
Matrix, Projects, and Settings; a Today/player surface is new.

Reuse the [serialized mutation writer](../../apps/mobile/src/application/mutations.ts),
account/session fencing, journal, and sync. Current
[entity caches](../../apps/mobile/src/db/entities.ts) only understand projects,
tasks, pages, and chats. Adding entities requires explicit fold/cache/journal and
Worker support; this is not solely a UI refactor. Retain existing task readers
and migrations and the four widget facades F1–F4.

Proposed core-owned records; exact schemas/event names are DP0 work:

| Record | Identity / essential data | Invariants |
| --- | --- | --- |
| Day stack | Account, local calendar day, planning timezone | Independent daily order; tomorrow uses local calendar arithmetic, not 24 elapsed hours. Keep the chosen day stable when travelling. |
| Stack entry | Entry ID, day, order, kind, optional task ID, title for activities, context, original/revised allocation, entry disposition, manual/generated origin | References current tasks; completed/deferred/removed entries remain in day history. Generated breaks have stable boundaries and suppression history. At most one playable entry per linked task per day in v1. |
| Run interval | Interval ID, entry ID, owner device, UTC start/end or active state | Immutable identities and idempotent start/stop; at most one open interval per device. Repeated taps/replayed sync do not count time twice. |
| Template | Template ID/version, ordered item definitions and durations | Instantiation IDs are stable for retries; later template edits do not mutate existing days. |
| Break/player preferences | Work interval, break duration, auto-insertion enabled, scene selection/media state | Defaults and bounds validated in core; media state is independent of work state. Breaks are actual entries, not notifications. |

Original estimate, revised daily allocation, actual elapsed time, and remaining
allowance are different values. Remaining allowance is `max(0, revised - actual)`
for that day's entry, not a negative number or a lifetime task estimate. A
tomorrow transfer preserves historical intervals on their source day and carries
an editable positive remaining allowance; if exhausted, ask for a fresh allowance.
Do not move yesterday's actual time into tomorrow's totals.

## Key facades

Names/paths below are proposed. They simplify existing application boundaries;
no new class hierarchy or timer server is implied.

| Facade | Consumer → provider; proposed location | Operations / semantic inputs and outputs |
| --- | --- | --- |
| DS1 `DailyStack` | Today and chat stack actions → core planners plus existing mutation writer; mobile `src/application/dailyStack.ts`, pure core `src/dailyStack.ts` | Assemble day from queue/template/policy with stable account/day identity → one ready stack; read → live entries/forecast; add/reorder/allocate/remove/insert break → committed result; defer to next day → atomic receipt. Commands take explicit identities and desired changes. |
| DS2 `StackPlayer` | Player controls and current task status bridge → interval planner, shared writer, clock/notification/media adapters; mobile `src/application/stackPlayer.ts`, pure core `src/stackPlayer.ts` | Play/pause/resume/extend/later/finish/take break → committed active/paused/idle state; read with supplied now → elapsed/remaining/overtime/forecast. Separate selectScene/volume commands take catalog IDs/preferences and cannot mutate run state. Linked completion shares F1's task planner. |
| DS3 `StackTemplates` | Template picker/day planner → pure instantiation and break reconciliation plus shared writer; mobile `src/application/stackTemplates.ts`, pure core `src/stackTemplates.ts` | Apply template plus queue/invocation ID → independent entries; reconcile automatic breaks using budget, preferences, origin, and suppressions → an idempotent planned change set, committed atomically with assembly/reorder/extension. Explicit manual edits remain authoritative. |

All reads resolve linked tasks from the existing committed store. Player state
lives for the account session above screens, not per widget. A failed commit
does not advance playback or display completion; preserve actionable typed writer
failures and retry identities. Account switches close/fence runtime callbacks and
cancel that account's scheduled notifications before mounting another account.

Clock/notification adapters are ports, not new product facades. Persist interval
boundaries, not a decrement event each second. Derive live display using injected
clock readings, reconcile after sleep/reload, and expose corrections for an
accidentally running session or clock discontinuity. Never infer work completion
from a background callback. [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/)
is deferred scheduling, so it cannot be a precise second-by-second timer.
[Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
supports scheduled local reminders; pause/extension/finish must cancel or replace
the previous reminder. Denied permission leaves foreground playback usable.
Both adapters need Expo 58-compatible dependency/config review and device evidence.

**Device ownership:** v1 playback is device-owned, not an offline global mutex.
Disable a second device when a known remote run is active. Independently started
offline intervals can conflict: retain both, surface the overlap for resolution,
and do not silently sum overlap as authoritative actual time. Online takeover and
cross-device player controls can follow later; ordinary task/stack sync remains.

**Transport/compatibility:** extend core commands/events/fold, both persistence
adapters and shared sync schemas together. DP0 must define an explicit client
capability/upgrade gate before new events are emitted; old clients must not skip
unsupported events and advance their cursors. Existing v1 task events remain
readable. Reuse shared never-rest contracts and Standard Schema for any changed
unary DTOs. Keep Effect-only core and existing streaming host ownership. No new
unauthenticated player endpoint or separate timer WebSocket is justified.

## Delivery tasks and evidence

- [ ] **DP0 — Domain and compatibility contracts.** No prerequisites. Define the
  records, command/event schemas, run state machine, context metadata, clock
  inputs, and client upgrade gate in core/contracts. Specify active-task completion
  from F1, atomic deferral, restart/overlap handling, and time-history correction.
  Evidence: fixture traces for DSP-01–DSP-27, old-event conformance, and an explicit
  allowed dependency/wiring list. Core exports/contracts/composition are coordinator-owned.
- [ ] **DP1 — Pure planning and projections.** Depends on DP0. Add the proposed
  core modules and tests for daily order, allowance/forecast arithmetic, intervals,
  context, rollover, template binding, and break reconciliation. Evidence: deterministic
  tests with supplied clocks/IDs; extension preserves later allocations; midnight,
  daylight-saving boundaries, retries, and invalid/no-op commands are covered.
- [ ] **DP2 — Durable commands and sync.** Depends on DP1. Extend mobile and Worker
  journals/caches/FTS handling where relevant, mutation services, and shared sync
  validation. Evidence: forced transaction failure rolls back source/target day,
  task status, and interval changes together; duplicate delivery is idempotent;
  incompatible clients fail without cursor advancement. No history rewrite.
- [ ] **DP3 — Player runtime.** Depends on DP2. Implement DS2 and account-owned
  runtime composition with timestamp recovery and local reminder adapter. Evidence:
  play/pause/resume, overtime, Later/Tomorrow, background/foreground, killed app,
  permission denial, failed storage, and account switch preserve truthful state.
- [ ] **DP4 — Today and shared task controls.** Depends on DP3 and widget F1/F3
  interfaces. Add the Today stack/player surface, estimate/context editing, reorder,
  and links from task details/chat to add/view today's entry. Keep chat as a
  conversation with live blocks, without expanding priority regions. Include
  direct drag/reorder plus accessible move controls and Insert break at a chosen
  position. Evidence: player completion updates all chat copies; chat completion
  stops playback; daily reorder leaves global priority unchanged. Include dock/expanded modes and a
  scene chooser; verify scene/media changes do not affect timing or order and
  media failure is recoverable. Reuse `src/ui` and functional React.
- [ ] **DP5 — Templates and opening sequence.** Depends on DP2/DP4. Implement DS3
  save/load and the 10-minute mindfulness, 5-minute reprioritisation, 30-minute
  email example followed by existing queue order. Evidence: repeated invocation
  retries add nothing twice, editing today leaves template/past days unchanged,
  and linked email is not duplicated in the appended queue.
  Include once-per-day assembly from eligible backlog/carryover and the chosen
  default opening; repeated opens preserve manual day edits.
- [ ] **DP6 — Automatic and manual breaks.** Depends on DP1/DP3/DP5. Add default
  auto-insertion, interval/duration/off settings, manual insert/reorder/resize/remove,
  suppression-aware reconciliation, and elapsed-work nudges including long tasks.
  Evidence: a ready-to-play stack, no duplicate/reappearing breaks, manual edits
  preserved, no synthetic rest from dismissal, unchanged work-item order, and
  interruption/resumption of the same task.
- [ ] **DP7 — Integrated acceptance.** Depends on DP4–DP6. Implement scenario-named
  tests and record actual web/iOS/Android evidence separately. Run affected tests,
  all affected package typechecks, boundaries, and shared-contract fixtures. Verify
  two-device overlap reporting and schema rollout before enabling new writers.
  Complete the user's admin opening, extend a task, take a break, cycle Later
  twice, defer to tomorrow, reload, and find the retained task at the queue front.

The first useful delivery includes daily inbox assembly, playback, scenes,
deferral, templates, automatic breaks, and manual stack editing. Calendar
appointments, auto-detecting places, automatic rollover, recurring calendar
generation, template sharing, and intelligent estimates wait.
Do not auto-roll every unfinished day into an accumulating obligation. Missed
days remain available for explicit review.

## Risks and acceptance mapping

Qualitative pre-implementation judgments:

| Risk | Likelihood / impact | Mitigation / task | Remaining concern |
| --- | --- | --- | --- |
| Stack edits accidentally change global task status/order/due dates. | Medium / high | Separate entry model; atomic linked completion/deferral; DP0–DP2. | New entity mappings need both adapters. |
| Suspended timers drift or count paused time as work. | High / medium | Boundary timestamps, injected clocks, recovery/correction, no per-second journal; DP1/DP3. | Native suspension/notification behavior needs devices. |
| Offline devices start overlapping intervals. | Medium / high | Device ownership and visible reconciliation; DP0/DP2/DP7. | No first-delivery global offline exclusion guarantee. |
| Extension or break insertion destroys later allocations. | Medium / medium | Pure forecast and explicit insertion; DP1/DP6. | Projections are estimates, not appointments. |
| Tomorrow/template retries duplicate or hide work. | Medium / high | Stable identities, atomic transfer and template invocation, preserved front segment; DP1/DP2/DP5. | Old clients must honor the upgrade gate. |
| Automation repeatedly restores removed breaks or overwrites a manual edit. | Medium / medium | Stable origin, suppression, future-only reconciliation, editable cadence; DP1/DP6. | The person can skip a planned break without claiming rest. |

Gurki families DSP-01–DSP-04 and DSP-12/13/22 cover planning/templates (DP1/DP5);
DSP-05–DSP-11 and DSP-17–DSP-21 cover player/shared-state/durability (DP2–DP4/DP7);
DSP-14–DSP-16 and DSP-24/25/27 cover automatic/manual breaks (DP6); DSP-23 covers
daily assembly (DP5), and DSP-26 covers independent scene state (DP4). Tests live next
to the proposed core/mobile modules; persistence checks extend existing mutation
and database tests. Gurki lint/encode checks syntax and model structure, not the app.
All behavioral acceptance is pending.

## Evidence, assumptions, and sources

The user supplies the queue, player, flexible overruns, tomorrow deferral,
place/mode context, templates, opening sequence, and configurable break cadence.
The later refinement explicitly requests a daily-filled inbox, automatic break
injection, media-scene selection, and easy manual reordering/break insertion.
Proposed choices include a separate Today surface, 5-minute break duration,
explicit completion/advance, template/carryover precedence, device-owned playback,
and manual review rather than automatic rollover. These do not block drafting;
DP0 resolves engineering contracts before new data is written.

Reference review on 2026-11-10: [Chronocat](https://chronocat.app/) exposed a
Today planner/calendar, a bottom player, and Routines navigation in the public
browser view. Its [publisher's Play listing](https://play.google.com/store/apps/details?id=app.habitedge.chrono_cat)
describes time-blocking, a Play timer, overtime shifting later estimates, routines,
and moving tasks between days. These support the reference pattern; authenticated
player execution, template loading, and its internal timing semantics were not
verified. No account was created. Yatma-specific behavior above comes from the
user and proposed design, not an assertion that Chronocat implements every rule.

Subsequent browser review captured the sample 10/5/30 day stack, empty routine
editor/library, recurring-work editor, action menu, duration input, and Settings
in the [screenshot gallery](../references/chronocat/README.md). Settings reports
version 7.16.11. Three temporary labelled demo blocks were added for reference;
cleanup is pending after the preview began presenting an account gate/loading
state. Starting playback sent the preview to a blank page, so actual playback,
overtime, and deferral behavior remain unverified. See the gallery's current
fixture/cleanup status rather than assuming a clean account or a tested player.

Later captures verify the expanded focus view, scene/playlist chooser, and an
idle switch from library ambience to a Skyrim waterfall/forest scene without
resetting the displayed 10-minute timer. A five-minute break was entered in the
general block form, captured before Save, and dismissed. Drag reordering and
running scene switches were not exercised. Automatic daily fill/break injection
above is a Yatma target from the user, not a verified Chronocat feature.

Also consulted: linked repository files; Expo 58-era BackgroundTask and Notifications
documentation (timer/notification adapter limits); the
[Gurki spec](https://gurki.nz/spec) and [workbench](https://gurki.nz/workbench)
(acceptance language and deterministic validation). No app code or dependencies
are changed in this planning pass. Spec-validation evidence is recorded after
running the upstream toolchain; no runtime acceptance is implied.

Gurki validation used upstream revision
`d1b1f7fad53fc5c880a23faccd9007cdce7fa250` (package 0.1.0) from the existing
temporary validation checkout. Encode/decode generated the derived reports;
lint reports **0 errors and 0 warnings** across 27 scenario families. No app
tests or device acceptance were run.
