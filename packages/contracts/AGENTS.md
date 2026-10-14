# Contracts area

Read `docs/development/never-rest.md` and the upstream agent lookup linked there.

- This area is owned by the contract coordinator unless explicitly delegated.
- Keep one `ContractDef` per bounded context in a named module, using `as const satisfies ContractDef`.
- Export contracts and their schemas; do not add handlers, hosts, auth implementations, IO, or provider calls.
- Import shared core schemas and adapt them with `Schema.toStandardSchemaV1`; avoid duplicate DTO/schema definitions.
- Keep JSON outputs transport-stable and errors actionable. Public messages must already be safe.
- Do not put stream/byte routes on a served JSON contract. Frame schemas belong to the agreed host boundary.
- Record whether each operation is declared, mounted, and migrated; the sync route is initially declared only.
- Run focused conformance fixtures and `pnpm --filter @yatma/contracts typecheck`.
