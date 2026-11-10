# Storage and development startup

Status: startup improvements implemented; Turso evaluation proposed. Started
2026-10-17. This extends the [private-alpha plan](private-alpha.md); it does not
change its storage or two-device acceptance gates.

## Observed failure

The running web preview failed during local SQLite hydration with
`NoModificationAllowedError` from `createSyncAccessHandle`, followed by
`Invalid VFS state`. This is a persistence initialization failure. No React
server/client markup mismatch was observed.

In the installed `expo-sqlite` 58.0.10 implementation, each web worker opens
exclusive OPFS access handles for its entire `expo-sqlite` pool. The pool spans
account files and retains its handles after a database connection closes.
Another tab or worker can therefore block initialization. The worker assigns
its SQLite instance before its VFS finishes initializing; a failed VFS open
leaves later attempts returning `Invalid VFS state` until the page reloads.

The existing application serialized opens within one module, but did not claim
ownership across tabs or retain that serialization across Fast Refresh. On
hydration failure it published an empty, ready workspace with a placeholder
device ID. Screens then attempted more operations against unavailable storage.

## Target and implementation

Target: a developer starts the app from the repository root, opens a single
preview, and gets a durable local workspace without cloud credentials. Startup
failures explain recovery, retain the journal/outbox, and keep editing and sync
closed until local storage is ready.

Implemented in this pass:

- `pnpm dev` starts Expo; `pnpm dev:web` starts web development without also
  opening a system-browser tab. Open the printed URL in the chosen preview.
- Web database connections, open/write queues, account selection, and pool
  ownership live for the page lifetime and survive module replacement.
- An origin-wide Web Lock is claimed before any SQLite open. A competing tab
  receives an actionable failure before it starts the SQLite worker. All
  account files share this claim because Expo uses one pool.
- The claim lasts until page disposal. Releasing it when an individual database
  closes would incorrectly advertise that Expo's pool is available.
- Failed hydration leaves `ready` false. The root storage gate shows loading or
  recovery instead of mounting editable screens. Web recovery reloads the page;
  native retry reopens the selected account. The journal is never reset as part
  of this recovery.
- Older tabs that predate the claim still need to be closed or reloaded. A
  poisoned legacy worker must reload after the competing owner exits.

The current web adapter supports one active workspace tab per origin. A second
active tab requires a shared worker or an adapter with verified concurrent-tab
support; the ownership guard makes the present limitation explicit.

## Database direction

Yatma already implements local-first reads/writes with Expo SQLite, an immutable
event journal and local outbox, plus application sync to each user's Cloudflare
`UserSpace`. Offline and cross-device operation are existing goals with
implementation and regression coverage; the integrated two-device/native gates
remain open. Turso could reduce the infrastructure we maintain, but needs to
preserve the application's merge and authorization rules.

Evaluate **modern Turso Sync**, including `@tursodatabase/sync-react-native` and
the browser sync adapter. Keep this separate from an ordinary remote libSQL
client or older embedded read replicas. The official native SDK documents local
databases and push/pull; its README and announcement show different API shapes,
so pin a release and test that release's exports and types. Native integration
needs a rebuilt development client. See the [native SDK source](https://github.com/tursodatabase/turso/blob/main/bindings/react-native/README.md)
and [native announcement](https://turso.tech/blog/react-native-bindings-for-turso).

Turso's current [sync usage guide](https://docs.turso.tech/sync/usage) documents
local writes with explicit `push()`/`pull()`, last-push-wins conflicts, and
remote bootstrap on first connect unless disabled. Verify the equivalent
offline-first bootstrap option in the pinned native and browser SDKs. Reconnect,
foreground scheduling, and UI publication still need application integration.

Inference for this codebase: replicating the mutable `entities` table directly
would change Yatma's field-level `(at, id)` event fold and undo provenance into
row-level push ordering. A migration should first prove replication of immutable
event IDs with deterministic local projections. Device IDs, preferences,
acknowledgements, and sync cursors also need an explicit local/replicated split;
replicating `sync_meta` wholesale would share device identity incorrectly.

## Ordered work

| Step | Deliverable                                                             | Acceptance evidence                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DX0  | Root startup commands, durable web ownership, truthful startup/recovery | Focused regressions; actual browser first open, reload, competing tab, and recovery after its owner exits                                                                |
| DX1  | Reproducible startup checks and configuration                           | Node 24/pnpm verification; missing or invalid public configuration explained; account-switch and storage retry on iOS/Android                                            |
| DB0  | A short architecture decision comparing existing sync with Turso        | Pinned SDK matrix for Expo 58/RN 0.88, iOS, Android, browser and Worker; list components removed, components retained, measured latency, operational cost and auth model |
| DB1  | Isolated Turso event-journal spike                                      | Offline cold/warm start, two devices plus server writer, deterministic convergence, idempotency, atomic batches, undo after later edits, process restart                 |
| DB2  | Migration design if DB1 passes                                          | Import/export validation, retained unsent events, account isolation, deletion fencing, schema upgrades, cutover and rollback with one replication authority              |

DX1 should also configure and verify web cross-origin isolation headers through
Expo Router, including authenticated browser flows. The observed preview had
`crossOriginIsolated: false`; Expo's [SQLite web setup](https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup)
requires WASM handling and COOP/COEP headers for SharedArrayBuffer use. WASM
resolution is already configured. Browser pool ownership remains necessary.

DB0/DB1 must answer these questions with running examples:

1. Can both native platforms and the browser start and accept durable writes
   offline, including the first launch, then reconnect without losing edits?
2. Can two offline clients edit different fields of the same task, reconnect in
   either order, receive a server/agent batch, and reproduce the current fold
   and whole-batch undo? What happens to duplicate/conflicting event IDs?
3. How are user databases provisioned and scoped to verified Clerk identity?
   A per-user remote database is the starting proposal. Table permissions alone
   do not establish row isolation. Keep admin secrets in the Worker; prove
   scoped expiring client credentials, refresh, revocation and account deletion.
4. Which tables replicate? How do native/browser clients rebuild projections
   after pulls without syncing device IDs, local preferences, or overwriting
   newer local work? How is the existing server sequence/outbox protocol replaced?
5. Can the Cloudflare Worker/DO write the same journal while keeping domain
   validation and agent/account lifecycle fences? Keep durable turn supervision
   and streaming responsibilities until a replacement is demonstrated.
6. Does the pinned engine support this schema's transactions, constraints,
   PRAGMAs and required FTS5 behavior? Does its browser adapter coordinate tabs
   and clean up after Fast Refresh/reload? Benchmark foreground pulls and
   offline log growth rather than assuming realtime subscriptions.

Do not run custom event sync and database replication as simultaneous authorities
over the same live data. A passing spike should produce a deliberate contract
migration and an export/restore path before replacing production storage. Core
continues to import only Effect; provider SDKs stay behind runtime adapters.

## Evidence

- Observed the original OPFS failure and subsequent poisoned VFS in the running
  development preview. Confirmed the installed worker/pool initialization order
  by reading its source.
- Focused tests cover failed-open retry, schema cleanup, serialized first opens,
  rejection before SQLite starts in a competing tab, Fast Refresh connection and
  write-queue reuse, unsupported browser coordination, hydration failure,
  readiness, and successful retry. Record final commands/results below.
- `pnpm test`: 170 tests passed in 35 files. After tightening the hydration
  failure reducer, the focused database/startup suite passed all 15 tests.
  `pnpm --filter @yatma/mobile typecheck`, `pnpm check:boundaries`, and
  `git diff --check` passed. Shell runtime: Node 26.11.1 / pnpm 11.10.0;
  the configured Node 24 CI run was not performed in this shell.
- `pnpm dev:web --port 8083` started Metro successfully without opening a
  system-browser tab. The temporary command-check server was then stopped.
- In the collaborative browser on `localhost:8082`, the first tab opened the
  existing saved workspace, the second displayed only the ownership recovery
  screen, and the second opened successfully with Reload after the owner left
  the app. Repeated navigation/reload retained the existing task and showed no
  storage alert. No browser storage reset was used. The original `8081` origin
  also showed the intended recovery screen for its pre-existing competing owner.
- After triggering Metro file invalidation for `database.ts`, the browser kept
  the same page, runtime object and database promise, with editing available and
  no storage alert. Module replacement is also covered by the focused regression.
- Turso dependencies, accounts, databases and contracts are unchanged. The spike
  has not been implemented or accepted. Native SQLite, Cloudflare, authenticated
  sync and real two-device acceptance remain the private-alpha gates.
