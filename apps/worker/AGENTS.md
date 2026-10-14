# Worker area

Read root conventions, `docs/internals/interfaces.md`, and the assigned task brief.

- Keep the HTTP/WebSocket host and `UserSpace` composition thin; lease these files to one integration owner per wave.
- Contract modules live in `@yatma/contracts`; runtime handlers import them and call application services.
- Use Effect internally, with explicit typed failure conversion to neverthrow/RailError at the unary boundary.
- The mutation writer serializes snapshot/planning/stamping/commit. Journal, projections, and FTS commit atomically.
- Return original sequence assignments on retry; preserve immutable event content and existing readers.
- Publish only committed data; keep model/provider calls outside transactions and mutation locks.
- Turns are supervisor-owned, separate from request/subscriber lifetime. Explicit Stop cancels work; detaching observation does not.
- Share the core model toolkit and account for actual usage on every exit, including curator work.
- Coordinate account deletion, callback cancellation, and write fencing; do not ignore required external deletion failure.
- Durable storage, transport, runtime, and release agents edit only their assigned paths. Send wiring requests to the host owner.
- Run focused tests and `pnpm --filter @yatma/worker typecheck`; report actual Cloudflare evidence separately from node SQLite tests.
