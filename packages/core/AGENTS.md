# Core area

Read the root conventions and `docs/internals/interfaces.md` before changing public shapes.

- Own pure domain schemas, staged command planning, fold, clock, undo, selectors, context, and toolkit definitions.
- Import only `effect` and this package's modules. never-rest/neverthrow belong in contracts/runtime boundaries.
- Keep clock and ID inputs explicit in new planners; validate the complete batch and write nothing for no-ops.
- Preserve stored-event readers and deterministic order; every writer must use the same monotonic stamping policy.
- Undo aggregates full-batch entity/field history and preserves subsequent writes using provenance.
- Coordinate public DTO/schema and export changes before dependent agents implement consumers.
- `src/index.ts` is coordinator-owned unless export wiring is explicitly delegated.
- Prefer plain schema/discriminated failure data; follow the root restrictions on classes.
- Verify meaningful regressions with focused tests and `pnpm --filter @yatma/core typecheck`.
- Handoff includes interfaces/fixtures, invariants, actual checks, compatibility, and unverified runtime behavior.
