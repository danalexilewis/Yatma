# Conversation-led daily prioritisation

Planning date: 2026-11-11. Status: local implementation delivered; external acceptance and one unrelated suite failure remain.

This feature plan sits under [private-alpha](private-alpha.md) and builds on the
locally implemented [next build](next-build.md#product-refinements--2026-11-11).
It refines the product direction: **Conversation combines inbox and review;
Today holds the work the user has chosen to take on.** It does not change the
outstanding native/deployed acceptance scope of the release umbrella.

## Outcome and scope

As someone working across several projects and personal contexts, I want to
review incoming work with the LLM, understand consequences and tradeoffs, and
make an informed decision about what work to do today.

Success means the user can explain why their chosen work matters, see what fits
within their available time, and understand what they have deferred. Processing
all incoming items and completing the most tasks are not success measures.

Conversation is the shared intake and decision environment. Internal capture,
review prompts, and eventual integration items enter the same permanent thread,
with source/context preserved. Today remains the editable daily stack and player.
Receiving an item, reading it, discussing it, or receiving an LLM recommendation
does not itself add work to Today. Existing explicit user instructions to change
Today remain sufficient; avoid repeated confirmation for an already clear choice.

First delivery: on-demand review of existing work and newly captured tasks,
reasoned proposals, and explicit commitment through existing daily tools.
Second increment: optional scheduled review invitations and durable resurfacing.
Later increment: one selected external integration using the same intake model.
No provider choice blocks the first two increments. Full email replacement,
provider writeback, automatic priority scores, calendar integration, autonomous
commitments, and a new matrix surface are outside this plan.

## Current state and evidence

Inspected the working tree on the planning date, including substantial existing
uncommitted implementation. This plan does not alter that implementation.

- [`ChatDetailScreen`](../../apps/mobile/src/features/chat/ChatDetailScreen.tsx)
  uses `PERSONAL_THREAD_ID`; [`ChatScreen`](../../apps/mobile/src/features/chat/ChatScreen.tsx)
  redirects older chat-list links to it. No second inbox/chat list is needed.
- [`threadCapture.ts`](../../apps/mobile/src/application/threadCapture.ts)
  atomically creates a task and a system-reference receipt, with stable retry
  identity. `/list` exposes open tasks. These receipts do not yet represent a
  durable review disposition or an external source.
- [`dailyPlanning.ts`](../../apps/worker/src/agent/dailyPlanning.ts) implements
  `read_day` and `plan_day` through the serialized mutation writer, checks
  day membership, and requires reasons. [`dailyStack.ts`](../../apps/mobile/src/application/dailyStack.ts)
  explicitly excludes backlog from new-day assembly. Preserve those semantics.
- [`buildContext.ts`](../../packages/core/src/buildContext.ts) bounds context;
  conversation history alone cannot reliably retain unresolved decisions.
- [`UserSpace.ts`](../../apps/worker/src/UserSpace.ts) already uses Alchemy
  callbacks for idle curation. A daily scheduler must coexist with that machinery.
  [`reminders.ts`](../../apps/mobile/src/application/reminders.ts) is a local
  player reminder adapter, not a server-originated review scheduler.
- [`schemas.ts`](../../packages/core/src/schemas.ts) currently has user,
  assistant, and system messages. Presentation role must not grant external
  content instruction authority.
- The next-build ledger reports local tests and browser evidence for the existing
  features. This planning pass inspected code and documentation; it did not rerun
  those tests or verify native, provider, or Cloudflare behavior. Scheduled
  reviews, integration intake, and persistent review decisions remain proposed.

## Proposed experience

1. **Receive.** Task capture continues to work offline and posts its existing
   live receipt. A lightweight “Needs review” affordance in Conversation exposes
   outstanding items without requiring a scroll through history. Future inbound
   items show source, project/context, received time, and original link.
2. **Review.** “Plan today” or an ordinary request starts a discussion spanning
   existing commitments, new items, and relevant work across projects. The LLM
   asks about available time and desired outcomes when missing. It distinguishes
   recorded facts, user preferences, estimates, and unknowns.
3. **Compare.** Present a small, explainable candidate set: why each matters,
   deadlines and consequences of delay, dependencies, likely time, and uncertainty.
   Include important work without a new message or imminent deadline. Allow
   “show more” by project/context; disclose retrieval limits and omitted groups.
4. **Choose.** User can choose Today, retain for later, wait on someone, dismiss
   an inbound suggestion, or request clarification. A proposal names additions,
   removals, allocations, and what would be displaced. “I have two hours” is a
   constraint, not permission to edit; “Add A and B to Today” is permission.
5. **Commit.** Existing daily tools apply clear instructions in audited batches.
   Keep live task refs and a concise receipt in the thread. Today immediately
   reflects the same committed state. Retaining or dismissing an intake item
   does not silently complete/delete its linked task or alter its deadline.
6. **Return.** Deferred decisions remain queryable, with a reason and optional
   revisit date/condition. New arrivals can be reviewed while Today stays stable.
   Replanning explains consequences for the remaining day and preserves actuals.

Example: “You have two hours available. The client reply unblocks someone and
is due today. Design supports your stated weekly outcome. Admin can wait until
Thursday. Reply plus 75 minutes of design would use 95 minutes; allow a break
and some buffer. Would you like to use that plan?” A response selecting the plan
commits it; correcting the assumptions produces a revised proposal.

Prefer existing live widgets and composer controls. Add accessible buttons as
shortcuts into the same application operations; ordinary conversation remains
sufficient. Avoid a rigid questionnaire and avoid publishing every intake update
as an assistant turn.

## Data and interfaces

Exact schemas are a T1 deliverable. Locations below marked proposed are new.
Shared domain policy stays Effect-only in core. Unary contracts use shared
Effect schemas through Standard Schema, one `as const satisfies ContractDef`
module per area. Follow the [interface register](../internals/interfaces.md) and
[never-rest guide](../development/never-rest.md); retain existing streaming hosts.

| Boundary | Consumer → provider; location | Inputs / outputs and invariants |
| --- | --- | --- |
| Review state (proposed) | Conversation and LLM tools → core review policy and existing writers; proposed `packages/core/src/review.ts` plus existing schemas/events/fold/storage adapters | Stable review-item ID, optional linked task, source identity/revision, timestamps, disposition, reason and optional revisit condition. Return committed state and receipt. Review disposition is separate from task status and daily membership. Unseen/read state is separate from unresolved review state. Persist and sync decisions rather than infer them from prose. |
| Review context (proposed) | Turn context/tools → bounded account-scoped query; existing `buildContext.ts`, proposed Worker `agent/review.ts` | Planning date/timezone, outstanding intake, current daily commitments, relevant project briefs and task candidates → bounded evidence with IDs, reasons, pagination/coverage and unknowns. Resolve latest entities; history is supporting context. No global score is required. |
| Daily commitment (existing, extend only as needed) | Conversation actions/agent → `plan_day`, daily commands and serialized mutation service | Explicit selected operations → current-state validation, atomic mutations and receipt/Undo. Revalidate a stale proposal; disclose conflicts instead of silently replacing later edits. Intake disposition and linked daily selection should commit together where one user action requires both. |
| Inbound intake (proposed) | Internal capture, scheduled publisher, future provider adapters → Worker application intake service; proposed `application/intake.ts` | Verified account/source identity, stable delivery/item IDs, source revision, bounded content and provenance → durable item/message IDs or duplicate receipt. Persist source-to-task linkage. Repeated delivery cannot create repeated tasks; an update to the same source item retains identity. External suggestions can exist before a task is created. |
| Review operations (proposed) | Mobile typed client and host → proposed `packages/contracts/src/review.ts`, Worker `http/review.ts` | Read review state, apply dispositions, configure review schedule; expected validation/not-found/conflict/unavailable errors. Authentication determines account; callers cannot supply arbitrary ownership. Reuse local writers for offline user edits. |
| Scheduled review (proposed) | Optional account preference → persisted Worker callback/job through UserSpace composition | Enabled flag, local review time, IANA timezone, schedule version → one durable invitation per occurrence and next due time. Callback reads current state and account lifecycle. No model turn or daily mutation is required to publish an invitation. |
| Provider adapter (later, proposed) | Verified provider webhook/poller → intake service | Provider event → canonical item with original provenance and dedupe identity. Authenticate source, bound payload, reject account mismatch and stale revisions; report retryable ingestion failure. Provider SDKs remain Worker-only. |

A single intake entry point is justified because several producers need identical
ownership, deduplication, provenance and publication rules. It is not a new task
store or a replacement for the existing mutation service. Start with internal
capture and test fixtures; avoid a general connector framework.

Keep new persisted records additive or explicitly migrate them. Cover core
folding, SQLite projections on both hosts, JSON export, sync capability gates,
undo semantics and account deletion together. Do not silently write records old
clients cannot understand. Freeze the concrete compatibility decision in T1.

## Scheduled and inbound messages

Scheduled messages are optional, quiet invitations to review; the user chooses
whether to engage. Default to on-demand review until the user enables a time.
Use one pending morning invitation per planning day, coalesce missed mornings
into the current review, and provide pause/change-time controls. Keep existing
curation callbacks running. Verify Alchemy 2.0.0-beta.80 callback persistence,
retry and cancellation behavior before choosing its exact implementation.

Cloudflare provides at-least-once alarm execution and one native alarm per
Durable Object, so durable deduplication and shared scheduler composition are
required. Do not introduce a competing direct `setAlarm()` loop alongside
Alchemy callbacks. [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
supports this runtime constraint; the quiet invitation and catch-up policy are
product decisions in this plan.

Persist the invitation through the ordinary journal and sync flow even when all
clients are closed. Push notifications are optional later delivery hints;
notification permission and device delivery do not determine whether the item
exists. Opening an invitation starts/reuses a normal user-driven review turn.
Ingestion and invitation publication do not consume model budget. LLM failure
leaves items available for manual review.

External material is evidence supplied by a source, never trusted instructions.
Keep provenance explicit in model context, constrain tool use to verified user
intent, and never let text in a provider item authorize task/day edits. Reopening
or resolving a provider item and writing back to that provider require separate
policies; initial integration is read-only.

## Ordered delivery tasks

- [x] **T1 — Freeze review semantics and compatibility.** No prerequisites.
  Add acceptance scenarios in proposed `docs/specs/conversation-prioritisation.spec.md`;
  define review-item/source/disposition schemas, capture backfill policy, candidate
  coverage, stale-proposal behavior, source revision rules and sync-reader policy.
  Inspect pinned Alchemy callbacks and existing projection/export/deletion paths.
  Done when contract fixtures and a reviewed schema/migration proposal explain
  old-client behavior and scheduler coexistence. Do not mark runtime support proven.
- [x] **T2 — Persist intake and decisions.** Depends on T1. Implement core
  policy/events/fold and both persistence adapters; add the intake service and
  review contract/client/host using existing writers. Wire capture to one linked
  review item without duplicating its current receipt; old backlog remains
  available for review without flooding historical receipts. Done when atomic
  rollback, retry, source update, offline merge, ownership and deletion tests pass.
- [x] **T3 — Ground the prioritisation dialogue.** Depends on T2. Extend bounded
  context and shared tool schemas/Worker handlers with review evidence and
  dispositions; reuse `read_day`/`plan_day`. Separate proposal and commitment,
  expose capacity arithmetic/unknown estimates, and support correction and
  cross-project coverage. Done when scripted real-turn tests show recommendations
  make no daily writes, explicit choices commit once, and stale/foreign references
  fail safely. Include malicious instructions embedded in inbound content.
- [ ] **T4 — Deliver Conversation review.** Depends on T2–T3. Extend existing
  chat screen/timeline/live widgets and application actions with Review/Plan today,
  pending-item access, source information, choices and recovery. Today remains
  the commitment surface. Done when mobile/desktop walkthroughs can capture,
  compare, choose, defer and reload without losing draft, reading position, review
  state or daily membership; verify keyboard and screen-reader access.
- [ ] **T5 — Accept the on-demand daily decision loop.** Depends on T4. Run the
  integrated scenarios below and relevant repository tests/type/boundary/spec
  checks. Update interface register and release/next-build cross-links with actual
  evidence. Done when first-delivery acceptance is recorded separately from
  provider/native/deployed checks. This is the first independently useful release.
- [ ] **T6 — Add optional scheduled invitations and resurfacing.** Depends on T5.
  Persist time/timezone preferences, register callbacks through existing UserSpace
  composition, dedupe publication and handle disable/deletion/restart races.
  Support date-based revisits first; describe condition-based revisits as manual
  until their event source exists. Done when fake-clock/restart fixtures cover
  DST, timezone change, missed days, duplicate callbacks and overlap with curation;
  a deployed closed-client test separately proves durable publication and catch-up.
- [ ] **T7 — Add one external integration.** Depends on T5; independent of T6.
  Select the provider and its read-only scope with the user, then research its
  official auth/delivery rules. Implement one adapter, connection/revoke controls,
  source links, update/dedupe handling and operational failure status. Done when
  provider fixtures and a real authorized account prove retry/update ingestion,
  review-to-task linkage and revocation, with no automatic Today selection.

## Risks

Qualitative planning judgments; mitigations are proposed, not verified.

| Risk | Likelihood | Impact | Mitigation and task | Remaining concern |
| --- | --- | --- | --- | --- |
| New arrivals dominate review and hide consequential existing work | Medium | High | Cross-project retrieval, explicit coverage and user-selected outcomes, T3/T5 | Importance still needs user judgement |
| A recommendation or external instruction becomes an unwanted commitment | Medium | High | Explicit choice, provenance separation, tool tests and stale checks, T3 | Real-model behaviour needs evaluation beyond scripts |
| Retry/update creates duplicate work or loses a review decision | Medium | High | Stable source identity/revisions and atomic persistence, T1/T2/T7 | Provider ordering rules vary |
| Review state and Today disagree after concurrent edits | Medium | High | Separate semantics, atomic linked commands, conflict/Undo/convergence tests, T2/T3/T5 | Connected-device proof remains necessary |
| Scheduler conflicts with curation or repeatedly interrupts users | Medium | Medium | Existing callback composition, optional schedule, coalescing and dedupe, T1/T6 | Deployed restart and timing behaviour needs proof |
| Bounded context creates misleading confidence or an unrealistic day | Medium | High | Coverage disclosure, missing-estimate labels, explicit capacity/buffer, T3/T5 | Estimates and user availability can change |

## Validation and delivery

Acceptance scenarios must demonstrate:

- Three projects plus personal work, a new request, an important undated task,
  an existing commitment and limited availability. User sees reasons and selects
  a feasible day; omitted work remains recoverable with a clear disposition.
- A suggestion-only conversation leaves Today unchanged. An explicit selection
  updates the same live task/day state, with a receipt and appropriate Undo.
- A late arrival leads to a discussed tradeoff; it never silently displaces the
  active task. Changed/deleted tasks invalidate stale proposals safely.
- Offline capture/review survives reload; reconnect and a second client do not
  duplicate items or misrepresent decisions. Account switching/deletion fences
  callbacks, ingestion, streams and pending writes.
- The model is unavailable or budget is exhausted: durable intake remains visible
  and manual selection/defer still works. A shortened context discloses coverage.
- Scheduler retry, disabled schedule, DST change, days of absence and closed
  clients produce the intended invitation count without changing Today.

Run focused tests per increment, then repository-required checks. Separate local
fixtures, UI observation, actual-provider evaluation, connected-client tests and
native/Cloudflare acceptance in the ledger. Do not expand previously deferred
release acceptance into provisioning work without a new execution scope.

Ship on-demand first, then scheduling, then the selected connector. Disable new
schedule/connector producers if needed while preserving received items, decisions
and daily history. Compatibility recovery must retain readable persisted data.

For product evaluation, ask users to explain their selected priorities and what
happens to deferred work. Observe time/effort needed to reach a useful decision,
reason corrections, and unwanted commitments. More cleared inbox items alone
would not establish success.

## Assumptions and open decisions

No blocking product decision for T1–T5: use the permanent account conversation,
existing Today stack, on-demand review, explicit commitments and no automatic
backlog import. Capacity is user supplied initially; calendar access is optional.
Do not infer a settled preference from a single conversational statement.

Before T6 delivery, choose the offered default review time and timezone-change UX;
scheduling remains disabled until configured. Before T7, choose the first provider
and permission scope. Exact schemas, compatibility policy and pinned callback
support are implementation investigations in T1, not facts established here.

## Sources consulted

Accessed 2026-11-11:

- Repository paths linked above: primary evidence for existing surfaces and
  mutation boundaries. Code presence is not deployed acceptance.
- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/):
  native alarm retry/scheduling constraints; does not verify Alchemy callback behaviour.
- [GOV.UK: Writing user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories):
  outcome-led decomposition and observable acceptance. UI and phased delivery
  choices are this plan's product/engineering judgment.


## Execution ledger

Implementation pass: 2026-11-11. Existing dirty work was preserved. The following
records supersede the proposed current-state descriptions above; unchecked tasks
retain acceptance that has not been demonstrated. No deployment or provider
connection was performed.

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| T1 | verified locally | Shared review schemas, source revision rules, capability3, command semantics and 17 acceptance scenarios in `docs/specs/conversation-prioritisation.spec.md`; contract hosts reuse core DTOs through Standard Schema. Pinned Alchemy callback source inspected. |
| T2 | verified locally | Core fold/batch/Undo, both SQLite projections, atomic capture and Gmail intake, journal export and account lifecycle integration. Core, mobile persistence and Worker convergence tests pass. Real connected-device/account-deletion acceptance remains external. |
| T3 | verified locally | `read_review` and `decide_review` share the core toolkit and actual turn dispatcher. Seven Worker tests cover SQLite persistence, read-only advice, explicit choices, stale/terminal references, source data roles and revision convergence. An unlinked Gmail choice creates and links a task atomically; retry cannot duplicate it. Both review and linked-task versions are checked inside the atomic planner. Actual model quality/injection resistance remains unverified. |
| T4 | implemented; web observed | Conversation review modal, filters, source context, reasons/revisit dates, choices, Undo, Plan today draft shortcut, optional schedule/Gmail controls. Desktop1280×800 capture/review/Today and mobile390×844 review/settings verified in real Expo web; reload retains decision and live task. Screen-reader/native interaction remains unverified. |
| T5 | partial acceptance | All package typechecks and boundary/spec checks pass. Full suite:356 pass,1 fail in untouched Today hover test (details below). Actual model, connected clients and native acceptance remain pending. |
| T6 | implemented; fixtures verified | Persisted optional schedule, named Alchemy callback, restart rearming, day identity, current-day catch-up and disable/version checks. Schedule updates/publication share a lock; account deletion fences producer cleanup. Four scheduler fixtures pass. Deployed closed-client/restart acceptance requires configured Cloudflare environment. |
| T7 | implemented; fixtures verified; configuration blocked | User selected Gmail. PKCE OAuth begin/complete/status, bounded read-only inbox import, revision/source identity, retryable revoke, typed clients and callback app route are wired. OAuth/intake/HTTP fixtures pass. No configured OAuth client or authorized mailbox is present; real provider acceptance is pending. |

### Scope decisions made during implementation

- `review.receive`, `review.decide`, `review.seen`, `review.link` and Undo use the
  existing mutation and sync boundaries. The review HTTP contract serves schedule
  settings; a second HTTP review-mutation endpoint would duplicate the working
  offline command path, so it was not added. This is an intentional simplification
  of the proposed interface table, not a disconnected service.
- Review evidence is retrieved through a read-only tool rather than expanding
  every initial prompt: default10/max20 items and800 characters of source snippet
  per item, with total/nextOffset and disclosed truncation. Existing backlog/day
  tools provide cross-project context beyond new arrivals.
- The schedule defaults to disabled,09:00,UTC on the server. The user explicitly
  saves local time and timezone. The app displays these editable settings.
- Gmail imports up to20 INBOX messages per request, with subject/sender/snippet
  and original links; further pages are explicit. No mailbox writes, polling or
  push subscription were added. Review arrivals are not automatic tasks or daily
  commitments. A user choosing Today creates a task when necessary.
- New provider receipt events cannot enter through client sync/turn event batches.
  OAuth refresh tokens stay in the account DO's private table, outside exported
  journal events. Revocation failure retains a retryable disconnect state; account
  deletion holds producer locks through the deletion fence.
- Google OAuth configuration and native/deployed acceptance remain external
  prerequisites, per the plan's original release scope. See
  [Gmail setup](../development/gmail.md) for exact environment variables and steps.

### Verification evidence

Commands used Node24.22.2 from the locally cached `node@24` executable, with its
bin directory prepended to PATH, and pnpm11.10.0:

- `pnpm -r typecheck`: all four workspace packages pass.
- `pnpm test`: **356 passing,1 failing,60 files**. The remaining failure is
  `apps/mobile/src/features/today/TodayEntryRow.test.ts`, “reveals from a child
  anywhere in the card and fades out on leaving the card”: expected `Start Plan
  the day` during fade-out, but the control is absent. This implementation did not
  edit that test or Today row; concurrent workspace changes in that area were
  observed. This is not a clean full-suite acceptance result.
- `pnpm check:boundaries`: pass.
- `pnpm check:specs`: all three specs,0 errors/0 warnings, including the new
  conversation-prioritisation model.
- `git diff --check`: pass at the final integration inspection.
- Browser: real Expo/SQLite on an isolated local port8083 after port8081 was
  already locked by another tab. Created “Review test: prepare client proposal”,
  observed Needs review1, entered a reason, selected Today, observed Needs review0,
  receipt and daily entry. Reload preserved receipt/choice; mobile390px review
  modal had no horizontal overflow and exposed settings and existing commitment.
  Local signed-out state correctly explains that connected settings require sign-in.
- Scripted provider/model tests are not proof of a real Google account, actual
  model decisions, Cloudflare callback persistence, native UI or two-device sync.

### Remaining prerequisites

1. Configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REDIRECT_URI`,
   register the app `/gmail-callback` redirect, then authorize a test mailbox.
   Only example environment files were found in the app/Worker folders; all three Gmail variables are unset in the execution process.
2. Use the configured deployed Worker/auth/model environment for closed-client
   scheduling, real-model prioritisation and connected-client acceptance.
3. Resolve the separately changing Today hover test and run the final release
   acceptance checks, including native/screen-reader behavior. These remain
   explicitly unaccepted rather than being marked done by local implementation.
