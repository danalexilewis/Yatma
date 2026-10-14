# Agent conventions

## React

- Functional React only; no TypeScript classes in UI code.
- Prefer named functions over pipe-style helpers.
- Do not use `useMemo` or `useCallback` unless there is no other option.
- Early returns go under hooks, before core logic.
- Prefer the project's component library when adding UI.

## Packages and boundaries

- Shared domain logic lives in `@yatma/core`. Core may import **only** `effect` (and its own modules).
- Server-only packages stay in the worker (`apps/worker`). Do not import them from the Expo app.
- Classes are allowed only for Effect service tags, Worker entrypoints, and Durable Objects.

## Versions

- Effect: `4.0.1` (via pnpm catalog)
- Alchemy: `2.0.0-beta.80`

## Style

- Keep changes focused; match existing naming and file layout.
- Verbose-but-short JSDoc on non-obvious exports.
- Always include imports at the top of the file for modules you add.

## Delivery and parallel agents

- Active delivery plan: `docs/plans/private-alpha.md`. Key interfaces: `docs/internals/interfaces.md`.
- Before delegation, follow `docs/development/sub-agents.md` and assign explicit file ownership.
- Root manifests, lockfile, package exports, shared contract changes, and composition-file leases are coordinator-owned.
- Do not edit another agent's area or switch/reset the shared working tree. Send a contract or wiring proposal to the coordinator.
- Distinguish target behavior, implemented behavior, and verified evidence in documentation and handoffs.

## never-rest boundaries

- Guide: `docs/development/never-rest.md`; version `0.7.0` via the pnpm catalog.
- Shared contracts live in `@yatma/contracts`, one module per area, with `as const satisfies ContractDef`.
- Handlers, hosts, clients, dispatchers, and tests import the same contract; contract modules contain no runtime implementation.
- Reuse Effect schemas through Standard Schema instead of duplicating schemas or model-tool descriptors.
- Keep Effect inside application/domain code and neverthrow Result at the API boundary. Core still imports only Effect.
- Streaming frames and audio bytes stay in host adapters with separate schemas/lifecycles.
