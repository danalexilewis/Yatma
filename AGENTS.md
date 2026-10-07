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
