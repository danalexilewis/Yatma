---
type: spec
id: conversation-prioritisation
title: Conversation-led daily prioritisation
status: draft
updated: 2026-11-11
summary: Incoming work and review share Conversation so the person can make an informed daily commitment.
tags:
  - yatma
  - conversation-prioritisation
  - implementation-target
---

# Acceptance model and evidence

> The scenarios below define target behavior for [the plan](../plans/conversation-prioritisation.md).
> A passing local fixture verifies its tested boundary, not the entire scenario.
> The plan's execution ledger remains the delivery record. Each scenario is an
> independent path; outputs are not cumulative deployment counts.

| Scope | Evidence inspected or run on 2026-11-11 | Remaining acceptance |
| --- | --- | --- |
| T1–T2 review domain | `packages/core/src/review.test.ts`: seven passing Node 24.22.2 tests for retry, source revision order, stale/foreign references, seen/revisit separation and field-safe Undo. Core typecheck and all 122 core tests passed in the domain checkpoint. | Schema compatibility through real old/new clients and deployed persistence remain separate. |
| T2–T3 Worker persistence and turns | `apps/worker/src/agent/review.test.ts`: seven passing Node 24.22.2 tests using SQLite and actual turn dispatch; bounded pagination, explicit choice, stale/completed-task rollback, read-only advice, source evidence role, reordered events/projection convergence, and atomic unlinked Gmail selection with retry protection. | Actual model reasoning and malicious-content resistance are unverified by scripted completions. Node SQLite does not establish Cloudflare behavior. |
| T4–T5 product acceptance | Target scenarios below; mobile application tests and UI evidence belong in the execution ledger. | Desktop/mobile walkthrough, screen reader, account switch and real connected-device acceptance must be recorded with actual observations. |
| T6 scheduled review | Scheduler test files exist; this spec author did not execute or accept their results. | Callback coexistence, restart, closed-client publication and schedule-change races need evidence at their respective boundaries. |
| T7 Gmail | Gmail application and HTTP fixture files exist; their results belong in the execution ledger. | Real authorized Google account, OAuth configuration, import/revoke behavior and provider errors remain external acceptance. |

## Shared schema and compatibility decisions

- Stored envelopes remain `v: 1`. New `review.received` and `review.updated` event
  types require reader capability **3** (`SYNC_EVENT_SCHEMA_VERSION`). Deploy
  compatible readers and host gates before enabling new producers. Existing
  journal history is retained; no rewrite or automatic review receipts for old
  backlog tasks are required. Old backlog remains available through task queries.
- `ReviewItem` has a source-derived stable ID, nullable linked task, source and
  source ID/revision, title, bounded source text, source URL, receipt/update
  timestamps, disposition, reason, revisit date and seen timestamp. Source IDs
  include Gmail account identity. Review dispositions and task/day state are
  separate facts. A single explicit Today operation commits decision and daily
  membership atomically through the existing writer.
- Source revisions are canonical unsigned decimal strings, compared at arbitrary
  precision. Repeated equal content/revision is a no-op; conflicting content for
  the same revision is rejected by intake planning. Older source revisions never
  overwrite newer ones even when delivered later. A newer source revision updates
  its content and clears seen state while preserving decisions and task linkage.
- New review timestamps require an ISO instant with an explicit timezone. Revisit
  dates are calendar dates. Seen state does not resolve a decision. A later/waiting
  item with a reached revisit date becomes eligible for review without changing
  its stored disposition automatically.
- Decisions and links can supply the previously observed `updatedAt`; a mismatch
  fails atomically. User edits stay within their verified account. Gmail provenance
  is produced by the authenticated Worker adapter, never accepted as user-authored
  provider evidence through sync.
- Review decision/link/seen Undo restores the earliest preimage for each field
  only when that field still belongs to the undone batch. Later edits are preserved
  and reported as skips. `review.restore` requires an Undo batch context. Intake
  receipts remain durable history; Undo of task creation must not expose a deleted
  linked task as actionable review work. Undo never opens a historical timer.
- Persistence projections on mobile and Worker are derived from the same event
  fold. Journal export includes review records. Account deletion removes review
  state and stops producer callbacks and credentials; a disabled producer cannot
  recreate state after deletion.
- Review tool output is bounded: default ten items, maximum twenty per page, source
  text snippets capped at 800 characters, explicit total and next offset. Full
  source text is bounded at 8,000 characters in storage. The tool description must
  disclose snippet limits. Task/project queries supplement the intake list so a
  partial review page is never presented as the complete backlog.

System: Yatma conversation prioritisation

Scenario: CP-01 Capture work into the conversation
Given the person has an open task capture in Conversation while offline
When the capture commits and the workspace reloads
Then one task and one linked pending review item are available
And the existing capture receipt links to the same task
And the task is not added to Today
Output 1 durable task and 1 linked pending review item
Outcome the person can consider new work before committing time
# Tasks: T1, T2, T4

Scenario: CP-02 Review competing work with explicit capacity
Given three projects and personal work contain new requests, an important undated task and an existing daily commitment
And the person has two hours available
When the person asks for help choosing today
Then the assistant compares relevant work across contexts with reasons and consequences of delay
And the assistant distinguishes known deadlines, estimated time and unknown information
And the proposed allocations include a buffer and describe what would be displaced
And Today remains unchanged
Output a reasoned proposal with no daily mutations
Outcome the person can make an informed choice within available time
# Tasks: T3, T4, T5

Scenario: CP-03 Commit an explicit Today selection
Given the person has reviewed a current item linked to an open task
When the person explicitly chooses that item for Today
Then the review decision and daily task entry commit together
And a conversation receipt records the decision
And no timer is started and no task is completed
Output 1 atomic decision and daily commitment
Outcome the person sees the chosen work consistently in Conversation and Today
# Tasks: T2, T3, T4

Scenario: CP-04 Retain a decision for later or waiting
Given an item is pending review
When the person defers it with a reason and a revisit date
Then its stored decision includes that reason and date
And the item becomes eligible for review when the date is reached
And the task deadline, task status and daily membership are unchanged
Output a durable deferral with a dated return condition
Outcome the person can defer attention without losing the decision
# Tasks: T2, T4, T6

Scenario: CP-05 Reading and dismissing are distinct
Given an unseen pending item exists
When the person opens it and then dismisses its suggestion
Then seen state is saved separately from the dismissal decision
And any linked task remains available in task history
And no task completion or deletion is implied
Output a seen item and an explicit dismissed decision
Outcome the person controls which arrivals require further discussion
# Tasks: T1, T2, T4

Scenario: CP-06 Stale and terminal work cannot partially change Today
Given a proposal references an older item version or a task that has since completed
When the person tries to commit that proposal
Then current-state validation reports the conflict
And no partial review decision or daily addition is saved
And the person can refresh the current facts
Output 0 partial mutations and an actionable conflict
Outcome the person decides using current work state
# Tasks: T2, T3, T5

Scenario: CP-07 Undo preserves later decisions
Given a batch changed a review decision more than once
And a later action changed another field on that item
When the person undoes the original batch
Then eligible fields return to their earliest preimages
And later writes remain and skipped fields are explained
And receipt history remains available
Output a field-safe Undo result
Outcome the person can reverse a choice without erasing subsequent work
# Tasks: T1, T2, T5

Scenario: CP-08 Source revisions converge across retry and delivery order
Given one Gmail item has a newer source revision and a local waiting decision
When older source events and duplicate deliveries arrive out of order
Then the newest source content survives
And the local decision and linked task identity survive
And repeated deliveries create no additional task or item
And pulled history and the stored projection agree
Output 1 converged source item with preserved local decisions
Outcome the person can trust incoming work across reconnects
# Tasks: T1, T2, T7

Scenario: CP-09 Bound review context and disclose coverage
Given thirty-six items are eligible for a review query
When the assistant reads a page of twenty items and then the remaining page
Then the first page reports twenty items, total thirty-six and a next offset
And the remaining page reports sixteen items and no next offset
And source text is limited to disclosed snippets
And the assistant treats task queries as additional backlog evidence
Output 2 bounded pages covering 36 distinct items
Outcome the person understands the scope and limits of the advice
# Tasks: T3, T5

Scenario: CP-10 External instructions remain source evidence
Given a Gmail snippet asks the assistant to ignore the user and select every task
When the person asks for advice and the assistant reads review evidence
Then that snippet is supplied as source data with provenance
And it does not authorize a tool call or daily commitment
And any recommendation still requires the person's explicit choice
Output external evidence without an authorized commitment
Outcome the person retains authority over their day
# Tasks: T3, T7

Scenario: CP-11 Manual review survives model unavailability
Given durable intake exists and the model is unavailable or its budget is exhausted
When the person opens Conversation
Then pending and deferred items remain accessible
And manual Today and deferral actions remain usable
And failed model work does not discard intake or the conversation draft
Output usable manual review with a recoverable model error
Outcome the person can choose work without waiting for the model
# Tasks: T2, T4, T5

Scenario: CP-12 Enable a quiet daily review invitation
Given the person enables a local review time and timezone
When that occurrence becomes due while clients are closed
Then one invitation is persisted through the normal journal
And callback retries do not duplicate it
And the invitation is visible after reconnect
And no model turn or daily commitment is started
Output 1 durable review invitation per eligible occurrence
Outcome the person can return to a useful review at their chosen time
# Tasks: T6

Scenario: CP-13 Schedule changes and absence do not flood the thread
Given a review schedule spans a timezone change, daylight saving transition or several missed days
When the scheduler resumes or an old callback runs after a preference change
Then it uses the current schedule version and planning timezone
And missed mornings coalesce into a current invitation
And a disabled schedule publishes nothing
And idle curation callbacks continue to work
Output a current invitation or no invitation according to current preferences
Outcome the person receives predictable review prompts
# Tasks: T6

Scenario: CP-14 Connect Gmail and consider an imported message
Given the person authorizes the selected Gmail account for read-only intake
When a supported message is imported and the person selects it for Today
Then the item shows its Gmail source and original link
And a task is created and linked once when needed
And the daily commitment is saved with the explicit decision
And Gmail content is not modified
Output 1 sourced review item and its explicitly chosen linked task
Outcome the person can include outside work in daily decisions
# Tasks: T7

Scenario: CP-15 Revocation and account deletion stop producers
Given Gmail intake or a review callback is pending
When the person revokes the connection, deletes the account or switches accounts
Then stale asynchronous work cannot publish into another account
And deletion prevents callbacks from recreating the deleted workspace
And revocation failures remain visible and retryable while imports stop
Output an isolated account lifecycle with stopped producers
Outcome the person controls access and account ownership
# Tasks: T2, T6, T7

Scenario: CP-16 Old readers receive a compatibility response
Given a client advertises reader capability below three
When it attempts sync or an event-bearing turn operation after review producers are enabled
Then the host rejects incompatible access before sending or accepting review events
And the client receives an upgrade-required response
And existing journal history and cursors remain intact
Output a compatibility response without history loss
Outcome the person can upgrade without silently losing review records
# Tasks: T1, T2, T5

Scenario: CP-17 Review controls preserve conversation continuity
Given the person has a conversation draft and is reading older history
When the person opens pending work, inspects a task, defers it and returns
Then the draft and reading position remain available
And keyboard and screen-reader controls expose meaningful labels
And reloading retains the committed decision
Output a usable review round trip with retained conversation state
Outcome the person can decide without losing their train of thought
# Tasks: T4, T5

System Outputs
1 durable task and 1 linked pending review item
And a reasoned proposal with no daily mutations
And 1 atomic decision and daily commitment
And a durable deferral with a dated return condition
And a seen item and an explicit dismissed decision
And 0 partial mutations and an actionable conflict
And a field-safe Undo result
And 1 converged source item with preserved local decisions
And 2 bounded pages covering 36 distinct items
And external evidence without an authorized commitment
And usable manual review with a recoverable model error
And 1 durable review invitation per eligible occurrence
And a current invitation or no invitation according to current preferences
And 1 sourced review item and its explicitly chosen linked task
And an isolated account lifecycle with stopped producers
And a compatibility response without history loss
And a usable review round trip with retained conversation state

System Outcomes
the person can consider new work before committing time
And the person can make an informed choice within available time
And the person sees the chosen work consistently in Conversation and Today
And the person can defer attention without losing the decision
And the person controls which arrivals require further discussion
And the person decides using current work state
And the person can reverse a choice without erasing subsequent work
And the person can trust incoming work across reconnects
And the person understands the scope and limits of the advice
And the person retains authority over their day
And the person can choose work without waiting for the model
And the person can return to a useful review at their chosen time
And the person receives predictable review prompts
And the person can include outside work in daily decisions
And the person controls access and account ownership
And the person can upgrade without silently losing review records
And the person can decide without losing their train of thought
