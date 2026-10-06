# Architecture

Package boundaries and the phone ↔ Worker ↔ Durable Object shape for M2–M4.

## Runtime diagram

```mermaid
flowchart LR
  subgraph phone [Mobile app]
    screens[Screens and chat cards]
    atoms[Folded state atoms]
    localLog["SQLite: events, entities, outbox"]
    voice[Dictation]
  end
  subgraph cloud [Cloudflare]
    worker["Worker: Clerk check"]
    space["UserSpace Durable Object, one per user"]
    spaceDb["SQLite: events, entities, FTS"]
  end
  model["Cheap model via OpenRouter"]
  whisper["Workers AI Whisper fallback"]
  screens --> atoms
  atoms --> localLog
  localLog <-->|"Effect RPC over WebSocket"| worker
  worker --> space
  space --> spaceDb
  space -->|"agent turns and curator"| model
  voice --> screens
  voice -.-> whisper
```

## Detached agent turn

```mermaid
sequenceDiagram
  participant You
  participant App
  participant Space as UserSpace
  participant Model
  You->>App: Hold mic and speak three changes
  App->>App: Transcribe on device
  App->>Space: chat.send with text and unsent events
  Space->>Model: Context and tools
  Model->>Space: apply_changes with three operations
  Space->>Space: Plan with core rules and write one batch
  Space-->>App: Text plus a Changes item carrying the events
  App->>App: Apply events and show the change card with Undo
```

## Package boundaries

| Package / app | Owns | May import |
| --- | --- | --- |
| `packages/core` (`@yatma/core`) | Schemas, events, fold, clock, rules, order keys, undo, `buildContext`, refs, RPC group, tool definitions | **Only** `effect` (and its own modules) |
| `apps/mobile` | Expo UI, local SQLite, atoms, outbox, Clerk client, RPC client | `@yatma/core`, Expo / RN client libs — **never** Worker-only packages |
| `apps/worker` | Worker entry, Clerk verify, `UserSpace` DO, FTS, agent runtime, curator alarms | `@yatma/core`, `@clerk/backend`, `@effect/sql-sqlite-do`, `alchemy`, OpenRouter / Workers AI |

Rules:

- Server-only packages stay in the worker. Importing `@clerk/backend`, `@effect/sql-sqlite-do`, or `alchemy` from the Expo app is a bug.
- Classes only where Effect / alchemy require them (service tags, tagged errors, Worker, Durable Object). Everything else is functional.
- Phone and DO keep the same logical tables: append-only `events` plus folded `entities`, written in one transaction per applied batch.

## Where milestones land

| Milestone | Surface |
| --- | --- |
| M2 Sync | `sync.push` / `sync.subscribe`, DO store, clock, outbox, sign-out wipe, `account.delete` — see [sync.md](./sync.md) |
| M3 Agent | Detached turns, five tools, `buildContext`, change cards / undo, usage cap — see [agent.md](./agent.md) |
| M4 Handbook | Pages/briefs, Context tab, curator wrap-up + idle alarm — see [agent.md](./agent.md#curator-m4) |
