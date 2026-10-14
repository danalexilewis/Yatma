# never-rest in Yatma

Version: `@eddy-works/never-rest` 0.7.0, neverthrow 8.2.0, pinned in the pnpm catalog.
Upstream references: [documentation](https://project-eddy.github.io/never-rest/docs/),
[contract modules](https://github.com/project-eddy/never-rest/blob/0fa86c0b867361d25caf263c5e0dee4f31f79491/skills/never-rest/references/contract-modules.md),
[agent lookup skill](https://github.com/project-eddy/never-rest/blob/0fa86c0b867361d25caf263c5e0dee4f31f79491/skills/never-rest/SKILL.md).

## Role

never-rest puts a typed Result boundary around application areas. One shared
contract defines unary inputs, outputs, and declared failures; HTTP serving,
local dispatch, typed clients, and tests consume it. This gives implementation
agents a concrete law to work against without embedding a particular host or
database in that law.

It does not provide serialization of domain mutations, database transactions,
durable turn execution, or live subscription delivery. Those responsibilities
belong to the application interfaces in the [register](../internals/interfaces.md).

## Placement

- `packages/contracts/src/<area>.ts`: contract objects and owned/shared schemas.
- `apps/worker/src/http/<area>.ts`: HTTP mount/composition, importing the contract.
- Worker application modules: Effect services consuming domain policy and IO ports.
- Mobile client modules: import a contract and use the typed client or the established host adapter.
- `@yatma/core`: Effect-only policy/data; never-rest and neverthrow are not dependencies here.

Keep contracts out of handlers and entrypoints. Use named exports and
`as const satisfies ContractDef`; avoid a builder DSL or one giant catalog.
Runtime-specific code stays out of the shared package.

## What runs today

| Contract                  | Runtime status                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `@yatma/contracts/health` | Worker serves `GET /health` and `GET /`; WebSocket upgrades bypass this JSON mount |
| `@yatma/contracts/sync`   | `pushEvents` declaration and conformance fixtures; HTTP route is not mounted yet   |

The sync declaration adapts the existing core input/output schemas using
`Schema.toStandardSchemaV1`. S1/T1 must provide atomic/idempotent services and
authenticated adapters before that operation is exposed. Existing RPC consumers
remain in place during this first adoption step.

## Typed HTTP client

The health contract is usable without importing Worker code:

```ts
import { createClient } from "@eddy-works/never-rest/client";
import { healthContract } from "@yatma/contracts/health";

const health = createClient(healthContract, { baseUrl: "https://your-worker.example" });
const result = await health.getHealth({});

result.match(
  function showHealth(value) {
    console.log(value.service, value.stage);
  },
  function showFailure(error) {
    console.error(error.code, error.nextStep);
  },
);
```

The existing success shape is preserved. Other HTTP methods receive the
contract's host `route_not_found` response. A successful health request does not
verify Clerk, a user-space database, model access, or live sync.

## Effect and Result conversion

Keep Effect internal and neverthrow at the API boundary. The runtime adapter
provides the service environment, runs the operation, and maps expected typed
failures into a declared `RailError`. Defects become a safe `internal` boundary
failure with diagnostics sent to trusted logging, not embedded in a public message.

Do not convert every core planner to neverthrow. Do not erase a typed failure into
`Error(message)`. Preserve a stable code, advisory `nextStep`, retryability, and
trusted origin/cause/context. Explicitly test cancellation and environment cleanup
when the bridge is implemented in T1/R1.

Use one set of shared Effect schemas, adapted through Standard Schema. Do not
redefine the same body in Zod, manual JSON Schema, an RPC payload, and a model
tool. Real and scripted model adapters consume the core toolkit.

## Local dispatch and agent boundaries

`createLocalClient` supplies typed in-process calls. `createDispatcher` accepts
an operation name and unknown arguments from a host, validates them, and calls
the same handler. Both are useful for application composition and a future agent
bridge; neither is a persistent turn runner or a live stream implementation.

For future tool/MCP exposure, reuse the contract and verified policy through the
dispatcher. Do not expose database access or a new unauthenticated gateway just
to enable agent calls. Library/source guidance:
[local dispatch](https://project-eddy.github.io/never-rest/docs/api/#eddy-worksnever-restlocal),
[MCP adapter](https://project-eddy.github.io/never-rest/docs/mcp/).

## Streaming and audio

never-rest serves buffered JSON operations. Keep subscription frames, text/tool
progress, WebSocket upgrades, multipart uploads, and audio bytes on the host.
Separate unary turn control (`start/get/stop`) from `observeTurn`, and unary sync
push from event subscription. Define stream-frame schemas separately; a route's
output schema is its complete JSON response, not a stream-event schema.

Cooperative `api.handle(request, context)` lets a host mount neighboring paths
without claiming them. The current Worker checks upgrades before health. Future
hosts must authenticate/gate stream or byte paths before committing their response.
See [files and streams](https://project-eddy.github.io/never-rest/docs/files-and-streams/).

## Errors and policy

- Declare domain failure codes/statuses per operation.
- Use `origin` for service ownership and cause chains for trusted diagnostics.
- Make `nextStep` specific enough for an agent/UI to act on.
- Retry only when the operation is idempotent and the error indicates retryability.
- Keep messages safe before disclosure; public disclosure does not scrub arbitrary messages.
- Derive trust/disclosure from verified server policy, never a caller-supplied trust header.
- Add authenticated policy with complete operation coverage when mounting user operations.

The sync fixture tests show a declared `clock_skew` failure crossing HTTP with
advice intact and diagnostic context removed at public disclosure. This is the
pattern for actionable failures; it does not establish the future runtime's auth
or transaction behavior. See
[errors as intelligence](https://project-eddy.github.io/never-rest/docs/errors-as-intelligence/)
and [policy](https://project-eddy.github.io/never-rest/docs/advanced-usage/#definepolicy).

## Checks and migration

```bash
pnpm test
pnpm --filter @yatma/contracts typecheck
pnpm -r typecheck
```

Add output fixtures for JSON transport stability, invalid-input-before-side-effect
cases, declared failure mapping, and actual adapter conformance. Always import
the production contract in tests.

Migrate by bounded context:

1. Establish a shared contract and schema adapters.
2. Implement the application service and its safe mutation/lifecycle semantics.
3. Add HTTP/local/legacy-RPC adapters to that same service.
4. Update clients and run compatibility/acceptance checks.
5. Retire the old adapter only after all consumers migrate.

A transport change does not justify changing stored event version, dropping old
readers, or rewriting history. Contract changes are coordinated as described in
[sub-agent setup](sub-agents.md#contract-changes).
