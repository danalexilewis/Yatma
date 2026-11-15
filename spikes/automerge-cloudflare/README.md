# Automerge Repo on Cloudflare: isolated feasibility spike

Assessment date: 2026-11-16 (Pacific/Auckland). This experiment does not import
or migrate Yatma task records, mount a production route, or alter its sync authority.
Its own manifest and lockfile keep dependencies outside the application workspace.

## Result

**Cloudflare is viable for this pinned combination.** A custom WebSocket adapter
and SQLite storage adapter work in actual local workerd Durable Objects. The
experiment verifies offline changes, convergence and persistence; it does not yet
establish an appropriate replacement for Yatma's event-journal semantics or Expo
runtime acceptance. Keep the current Cloudflare POC on its existing protocol.

Pinned versions: Automerge 3.5.0; Repo, WebSocket client and IndexedDB adapter
2.5.4; Wrangler 4.162.0. Repo's npm `latest` was 2.6.0-alpha.3 and `next` was
3.0.0-alpha.2 during inspection. We chose 2.5.4 deliberately to assess the existing
adapter interfaces, rather than silently mix the alpha Subduction redesign into
the production architecture. The lockfile records the exact test environment.

## Reproduce

Use Node 24 and pnpm 11.10.0:

```sh
cd spikes/automerge-cloudflare
pnpm install
pnpm build
pnpm test
pnpm test:native-bundle
pnpm dev
```

The browser experiment runs at `https://localhost:8791`. Trust the root project's
`.certs/dev-ca.pem` in the test browser first. `dev.mjs` generates a leaf certificate
through `scripts/dev-tls.mjs`; it does not install a CA or disable validation.
`pnpm test` launches a child Node process that trusts only the additional project
CA through `NODE_EXTRA_CA_CERTS`, then starts Wrangler with the matching certificate.
It uses a fresh temporary persistence directory and removes it after the run.

Create a document, copy its Automerge URL to another browser, and use **Open
document**. Disconnect sync, change different fields, and reconnect. The browser
uses a dedicated IndexedDB database; it has no access to Yatma's database.

## Verified evidence

- `pnpm test` passed against local workerd using HTTPS/WSS with certificate
  verification enabled. Missing fixture authentication returns 401.
- Two independent Repo clients receive the same initial document. Disconnected
  clients edit different task fields, retain local changes, and converge after
  reconnect. One fixture replica also reopens its in-memory adapter while offline;
  this does not establish disk-backed offline restart on a browser or phone.
- A third Repo acts as a server/agent writer; its update reaches both clients.
- A random 240 KB field exercises SQLite blob chunking. After explicit flush,
  the entire Wrangler process stops and restarts against the same on-disk DO
  storage. A fresh client with no local data recovers all three fields.
- `pnpm build` passes for the browser bundle using the embedded-WASM entry point.
- `pnpm test:native-bundle` passes through Yatma's Expo iOS Metro pipeline. The
  probe clears listener-only TLS configuration because it opens no server.
  **This is bundling evidence only**, not Hermes execution or native persistence.
- The spike initially exposed a WebSocket binary-frame difference: this workerd
  version needed `binaryType = "arraybuffer"` (and Blob handling) before CBOR
  decoding. No FinalizationRegistry shim was needed in the tested workerd version.
- Repo emitted a `TimeoutNegativeWarning` during one passing run. The spike does
  not conceal it or infer production readiness from a passing happy path.

The automated clients are Node processes using independent repositories, not an
iPhone/Android or browser acceptance run. The browser UI could not be visually
accepted in the collaborative preview because its trust store rejects the local
CA (`ERR_CERT_AUTHORITY_INVALID`). No HTTP fallback was used.

## Integration implications

- Repo is document storage, synchronization and lifecycle management; it does not
  replace the authenticated chat/turn API or the agent supervisor.
- `worker.ts` demonstrates the Cloudflare-specific adapter work. It uses a
  WebSocketPair and synchronous SQL transactions for chunk replacement. It does
  not implement WebSocket hibernation/reconstruction. The prefix adapter scans
  stored keys; production would need indexing and workload measurements.
- The fixed `local-spike-only` token gates a local fixture room. This is **not**
  account authorization, a production credential, or a deployment configuration.
  Before mounting it in Yatma, the Worker must verify Clerk and select the account
  room itself; peer/document IDs do not prove authorization.
- Credentials, billing data and privileged server state must remain outside
  replicated documents. A production agent needs a trusted writer boundary.
- The task document here is deliberately small. Directly replacing Yatma's
  projections with CRDT maps would change conflict resolution and undo semantics.
  First compare replicating immutable domain events against direct document
  modeling, with whole-agent-batch undo after later edits and restart fixtures.
- Expo still needs an actual on-device Automerge engine and storage assessment.
  The upstream React Native bridge repository is currently a placeholder; do not
  treat a successful Metro bundle as an installed native engine. A maintained
  native/WASM integration may require a rebuilt development client.
- Browser multi-tab, offline browser reload, corrupted/failed storage, account
  isolation, deletion propagation, same-field conflicts, large histories, DO
  eviction/hibernation and deployed-cloud operation remain acceptance work.
- Decide whether to adopt the 2.x adapter model or the 3.x/Subduction model before
  a migration. Do not operate custom sync and Automerge as simultaneous authorities
  over the same production task data.

## Inspected primary sources

- [Repo storage adapters](https://automerge.org/docs/reference/repositories/storage/)
  and [networking](https://automerge.org/docs/reference/repositories/networking/):
  built-in browser/filesystem storage and Node-style WebSocket hosting.
- [Community PartyServer integration](https://github.com/cloudflare/partykit/issues/361):
  a separate implementation report, not an upstream Cloudflare-support guarantee.
- [November 2026 update](https://automerge.org/blog/2026-november/): Repo 3.0's alpha
  and the move to a Subduction/Sedimentree backend.
- [React Native bridge](https://github.com/automerge/react-native-automerge):
  the current upstream repository contains a placeholder README.
- [Reported local workerd issue](https://github.com/automerge/automerge-repo/issues/583):
  historical FinalizationRegistry failure, which did not reproduce with this pin.
