---
type: spec
id: daily-stack-player
title: Daily stack and task player
status: draft
updated: 2026-11-10
summary: A daily-filled work inbox with flexible timing, templates, automatic breaks, manual overrides, and independent media scenes.
sources:
  - title: Gurki language specification
    url: https://gurki.nz/spec
  - title: Chronocat reference
    url: https://chronocat.app/
tags:
  - yatma
  - daily-stack
  - implementation-target
---

> Target behavior supplied by the user and proposed in the
> [implementation plan](../plans/daily-stack-player.md), not verified app behavior.
> Each scenario is an independent acceptance path; generated reports do not count
> deployment totals. DSP identifiers are stable, and comments map facades/tasks.

System: Yatma daily stack and player

Scenario: DSP-01 Load the admin opening before the existing queue
Given today has an ordered work queue A then B then C and no carried work
When I apply the admin opening template
Then the stack begins with 10 minutes mindfulness, 5 minutes reprioritisation, and 30 minutes clear email
And A then B then C follow in their existing relative order
Output 3 opening blocks followed by the existing work queue
Outcome the person can pattern the start of the day without scripting every later task
# Facades: DS1, DS3; Tasks: DP1, DP5

Scenario: DSP-02 Daily reordering preserves global task priority
Given durable task priority is A then B then C
When I move C before A in today's stack
Then today plays C then A then B
And global task priority remains A then B then C
Output 1 committed daily reorder
Outcome the person can adapt today independently of the backlog
# Facades: DS1; Tasks: DP1, DP4

Scenario: DSP-03 Templates and past days remain independent
Given yesterday and today were instantiated from the same template
When I change today's email allocation from 30 minutes to 40 minutes
Then the template and yesterday retain their original allocations
Output 1 revised daily allocation
Outcome the person can adapt a single day without rewriting the routine
# Facades: DS3; Tasks: DP1, DP5

Scenario: DSP-04 Retrying a template does not duplicate its items
Given a template invocation has already committed its opening items
When that same invocation is retried
Then no additional daily entries or global tasks are created
And an explicitly linked email task does not also appear in the appended queue
Output 0 duplicate entries
Outcome a retry preserves the intended day pattern
# Facades: DS3; Tasks: DP1, DP2, DP5

Scenario: DSP-05 Play pause and resume record actual work
Given an idle work entry has a 30-minute allowance
When I play for 10 minutes, pause for 5 minutes, and resume for 3 minutes before pausing
Then actual work is 13 minutes and paused time is excluded
And remaining allowance is 17 minutes
Output 2 closed running intervals totalling 13 minutes
Outcome the person can see actual effort independently of clock time
# Facades: DS2; Tasks: DP1, DP3

Scenario: DSP-06 Overtime does not complete or fail the task
Given a task has been running for its 30-minute allocation
When another 4 minutes of work elapse
Then the player shows 34 minutes actual time and 4 minutes overtime
And the task remains open with Extend, Later today, Tomorrow, Pause, and Finish actions
Output an overtime presentation without a completion event
Outcome the person can adapt the plan without a failure penalty
# Facades: DS2; Tasks: DP1, DP3

Scenario: DSP-07 Extending a task shifts later projections
Given the active task has an original 30-minute estimate followed by another task and a break
When I add 10 minutes to the active allocation
Then its revised allocation is 40 minutes while its original estimate and actual time remain recorded
And later projected times move 10 minutes later without changing their allocations or order
Output 1 allocation extension and a revised forecast
Outcome the person can continue the current work with a truthful view of the remaining day
# Facades: DS1, DS2; Tasks: DP1, DP3

Scenario: DSP-08 Later today preserves effort and can be repeated
Given task A has 10 minutes logged against a 30-minute allowance before B and C
When I choose Later today for A
Then the queue is B then C then A with A still open
And A retains 10 minutes actual and 20 minutes remaining allowance
And Later today remains available when A comes around again
Output a closed interval and a reordered daily entry
Outcome work can wait for a better moment without losing recorded effort
# Facades: DS1, DS2; Tasks: DP1, DP2, DP3

Scenario: DSP-09 Tomorrow transfers the commitment without changing the task due date
Given A is active today and tomorrow already has work B then C
When I choose Tomorrow for A
Then today no longer offers A as playable and tomorrow starts with A before B then C
And A remains open with its project, due date, context, and recorded time preserved
And exhausted remaining allowance requires a new positive allowance rather than a zero-time loop
Output 1 atomic source-to-target transfer and a closed source interval
Outcome today's commitment is cleared while the task is available at the next day's queue front
# Facades: DS1, DS2; Tasks: DP1, DP2, DP3

Scenario: DSP-10 Multiple deferrals preserve order without duplicates
Given A then B are explicitly deferred to tomorrow
When the transfer commands are retried and their sync deliveries replayed
Then tomorrow retains one A then one B before previously queued work
And their source-day time is not counted again as tomorrow's time
Output 0 duplicate daily entries or intervals
Outcome carried work retains a stable next-day priority
# Facades: DS1; Tasks: DP1, DP2

Scenario: DSP-11 A failed transfer leaves both days and the player consistent
Given A is active today and its Tomorrow operation will fail persistence
When I attempt to defer A
Then no partial target entry, source removal, or interval stop is committed or published
And the player retains its previously committed state and offers retry
Output 0 partial changes and a typed save error
Outcome the person can recover without searching for a lost task
# Facades: DS1, DS2; Tasks: DP2, DP3

Scenario: DSP-12 Context and remove-from-today do not delete the task
Given a task requires the office and a deep-focus mental mode
And the person is somewhere else today
When the person removes it from today's stack
Then the durable task remains open and discoverable with its context requirements
And it is not automatically scheduled for tomorrow or marked done
Output 1 removed daily commitment and 0 task deletions
Outcome the person can clear an unsuitable item without losing the underlying work
# Facades: DS1; Tasks: DP1, DP4

Scenario: DSP-13 Opening rituals precede carried work without displacing its priority
Given tomorrow has deferred tasks A then B ahead of its work queue
When I explicitly load the admin opening into tomorrow
Then mindfulness and reprioritisation can precede the work queue
And A then B remain the first work tasks before the usual email block and other work
Output opening preparation entries with preserved carryover order
Outcome the person can retain a useful ritual while honouring deferred work
# Facades: DS1, DS3; Tasks: DP1, DP5

Scenario: DSP-14 Daily preparation automatically includes configurable breaks
Given eligible work allocations cross the configured 120-minute work interval
And automatic break insertion is enabled
When today's stack is assembled
Then real break entries with the configured duration appear near work boundaries without an acceptance dialog
And the relative work order and each task allocation are preserved
And the projected finish includes those breaks with no extra break after the final work item
Output a ready-to-play day stack with generated break entries
Outcome the person can press Start without first arranging recovery time manually
# Facades: DS1, DS3; Tasks: DP1, DP5, DP6

Scenario: DSP-15 Dismissing an in-task break nudge does not pretend rest occurred
Given actual work during a long task reaches a break threshold before the next planned break
When I dismiss the Break now nudge
Then the task queue and allocations remain unchanged
And the same threshold is not repeatedly presented on every render
And recorded work is not reset as if a break had occurred
Output a dismissed suggestion threshold and 0 synthetic rest intervals
Outcome the person can keep working and reconsider at the next configured interval
# Facades: DS2, DS3; Tasks: DP3, DP6

Scenario: DSP-16 An accepted break interrupts and can resume the same task
Given a long task is still open when actual work reaches a break threshold
When I accept a break and later finish its block
Then work and break intervals are recorded separately
And the unfinished task retains its identity, effort, and remaining allowance
And explicit Next or Play can resume it while a qualifying completed break resets the work accumulator
Output a closed work interval and a completed break interval
Outcome the person can recover without splitting or completing the underlying task
# Facades: DS2, DS3; Tasks: DP1, DP3, DP6

Scenario: DSP-17 Chat completion stops the same task in the player
Given a task is active in Today and appears in five chat widgets
When I complete it from one chat widget and the local operation commits
Then every copy shows the task as done and its daily entry is resolved
And the active run is closed without continuing to log invisible time
Output 1 atomic task completion, entry resolution, and interval stop
Outcome chat and the player remain two consistent views of the same task
# Facades: DS1, DS2, F1; Tasks: DP2, DP4, DP7

Scenario: DSP-18 Lock-screen recovery uses persisted interval boundaries
Given a running interval has a persisted start and no pause
When the app is suspended and later reopened after 7 elapsed minutes
Then the running display includes those 7 minutes rather than relying on missed per-second callbacks
And a clock discontinuity or accidental long run can be reviewed and corrected
Output a recovered timer projection from the saved interval
Outcome the person can trust recovery without an always-running JavaScript loop
# Facades: DS2; Tasks: DP1, DP3

Scenario: DSP-19 Account changes fence the old player and reminders
Given account A has an active player and scheduled reminder
When I switch to account B
Then A's runtime callbacks and reminder cannot update B's player or task state
And old operation completions do not publish into the new account
Output account-scoped runtime teardown and a clean account B view
Outcome playback state does not leak between people
# Facades: DS2; Tasks: DP3, DP7

Scenario: DSP-20 Offline playback overlap remains visible
Given two devices independently start work intervals while offline
When both histories synchronise
Then both recorded intervals are retained and the overlap is reported for resolution
And overlap is not silently summed as authoritative actual work
Output a visible timing conflict with preserved source intervals
Outcome effort remains reviewable without claiming a global offline player lock
# Facades: DS2; Tasks: DP0, DP2, DP7

Scenario: DSP-21 Reminder denial does not prevent local playback
Given local notification permission is denied
When I play, pause, or extend a task
Then foreground timing and committed interval recording remain usable
And permission denial is not reported as failed task persistence
Output working foreground playback without a scheduled notification
Outcome the person can use the stack without granting reminder permission
# Facades: DS2; Tasks: DP3

Scenario: DSP-22 Old clients cannot silently discard new stack events
Given a client cannot read the negotiated daily-stack event capability
When it attempts to synchronise a stream containing new stack events
Then the client receives an explicit upgrade or incompatibility result
And it does not discard those events and advance its cursor
And supported clients continue reading existing task history
Output an explicit compatibility failure without data loss
Outcome the new daily planning model can roll out without corrupting older histories
# Facades: DS1, DS2, DS3; Tasks: DP0, DP2, DP7

Scenario: DSP-23 Opening today assembles the daily inbox once
Given explicit deferrals and eligible open backlog tasks exist in priority order
And a default opening template is selected
When I open Today for the first time that day
Then the opening and work queue are materialized with configured automatic breaks
And completed, deleted, and explicitly future-planned tasks are excluded
And reopening the day preserves manual order, allocations, and existing task identities
Output one idempotently prepared daily inbox
Outcome the person can begin the day with Start rather than rebuilding the stack
# Facades: DS1, DS3; Tasks: DP1, DP2, DP5

Scenario: DSP-24 Manual break editing is available directly in the stack
Given today's automatically prepared stack contains tasks and breaks
When I insert a manual break between two tasks and change its duration or position
Then it is a real editable break entry and the forecast reflects the edit
And task order changes only when I explicitly reorder tasks
And removing or skipping a break never completes a work task or records invented rest
Output a manually adjusted daily stack with separate work and break identities
Outcome the person can adapt the rhythm while working without rebuilding the day
# Facades: DS1, DS2; Tasks: DP1, DP4, DP6

Scenario: DSP-25 Break reconciliation respects manual edits and removed boundaries
Given a generated break has been removed and another break has been manually resized
And one work interval is running while an earlier break is already complete
When I reorder pending tasks, extend an allocation, and rebuild the remaining forecast
Then future automatic breaks are reconciled without duplicates or a restored suppressed break
And the resized break, completed history, and active interval are preserved
Output an idempotent future-only break change set
Outcome automatic preparation continues to help without fighting the person's edits
# Facades: DS1, DS2, DS3; Tasks: DP1, DP2, DP6

Scenario: DSP-26 Scene selection does not change the work session
Given the expanded player has a selected scene and a task with recorded work
When I choose a different scene, change volume, or mute ambient media
Then the visual or audio selection changes while task identity, timer state, elapsed time, and queue remain unchanged
And unavailable media leaves timer and stack controls usable
Output an independent media preference change with no work mutation
Outcome the person can choose a focus environment without interrupting the session
# Facades: DS2; Tasks: DP3, DP4

Scenario: DSP-27 Disabling automatic breaks still permits manual breaks
Given automatic break insertion is disabled in preferences
When a day is prepared and I insert a break manually
Then no generated breaks are added and my explicit break remains playable
And reloading preserves the preference and the manual entry
Output a prepared queue containing only the explicitly chosen break
Outcome the person retains control over how recovery time is planned
# Facades: DS1, DS3; Tasks: DP5, DP6

System Outputs
3 opening blocks followed by the existing work queue
And 1 committed daily reorder
And 1 revised daily allocation
And 0 duplicate entries
And 2 closed running intervals totalling 13 minutes
And an overtime presentation without a completion event
And 1 allocation extension and a revised forecast
And a closed interval and a reordered daily entry
And 1 atomic source-to-target transfer and a closed source interval
And 0 duplicate daily entries or intervals
And 0 partial changes and a typed save error
And 1 removed daily commitment and 0 task deletions
And opening preparation entries with preserved carryover order
And a ready-to-play day stack with generated break entries
And a dismissed suggestion threshold and 0 synthetic rest intervals
And a closed work interval and a completed break interval
And 1 atomic task completion, entry resolution, and interval stop
And a recovered timer projection from the saved interval
And account-scoped runtime teardown and a clean account B view
And a visible timing conflict with preserved source intervals
And working foreground playback without a scheduled notification
And an explicit compatibility failure without data loss
And one idempotently prepared daily inbox
And a manually adjusted daily stack with separate work and break identities
And an idempotent future-only break change set
And an independent media preference change with no work mutation
And a prepared queue containing only the explicitly chosen break

System Outcomes
the person can pattern the start of the day without scripting every later task
And the person can adapt today independently of the backlog
And the person can adapt a single day without rewriting the routine
And a retry preserves the intended day pattern
And the person can see actual effort independently of clock time
And the person can adapt the plan without a failure penalty
And the person can continue the current work with a truthful view of the remaining day
And work can wait for a better moment without losing recorded effort
And today's commitment is cleared while the task is available at the next day's queue front
And carried work retains a stable next-day priority
And the person can recover without searching for a lost task
And the person can clear an unsuitable item without losing the underlying work
And the person can retain a useful ritual while honouring deferred work
And the person can press Start without first arranging recovery time manually
And the person can keep working and reconsider at the next configured interval
And the person can recover without splitting or completing the underlying task
And chat and the player remain two consistent views of the same task
And the person can trust recovery without an always-running JavaScript loop
And playback state does not leak between people
And effort remains reviewable without claiming a global offline player lock
And the person can use the stack without granting reminder permission
And the new daily planning model can roll out without corrupting older histories
And the person can begin the day with Start rather than rebuilding the stack
And the person can adapt the rhythm while working without rebuilding the day
And automatic preparation continues to help without fighting the person's edits
And the person can choose a focus environment without interrupting the session
And the person retains control over how recovery time is planned
