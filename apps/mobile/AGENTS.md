# Mobile area

Read root conventions, `docs/internals/interfaces.md`, and the assigned task brief.

- Keep UI functional and use `src/ui`. Retain the client/server package boundary.
- Screens submit commands to application services and display committed state and typed failures.
- Local persistence owns `src/db`, `src/events`, `src/state`, and the local mutation writer; transport owns `src/sync` and the auth bridge.
- Explicitly lease `state/atoms.ts`, auth/provider wiring, and routes before parallel edits.
- Serialize planning/commit/publication; do not publish a saved edit when SQLite failed.
- Remote merge, projections, sequence metadata, and cursor advance commit together before transport acknowledgement.
- Fence old asynchronous work on session/account changes.
- Import shared never-rest contracts rather than Worker code or duplicated wire shapes. Streaming has an independent host lifecycle.
- Change cards and undo consume the full durable turn batch, including after reload.
- Run focused tests and `pnpm --filter @yatma/mobile typecheck`; native evidence is separate from web/bundle evidence.
