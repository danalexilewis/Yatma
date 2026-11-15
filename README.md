# Yatma

Yet Another Task Management App — iOS-first tasks by touch or chat, with a local-first event log synced to a per-user Cloudflare Durable Object (`UserSpace`).

## Monorepo layout

```
apps/mobile/     Expo Router app (Clerk, SQLite, sync, chat)
apps/worker/     Cloudflare Worker + UserSpace Durable Object (alchemy)
packages/core/   Effect-only schemas, fold, rules, RPC, tools, buildContext
packages/contracts/ Shared never-rest JSON contracts and Effect schema adapters
docs/            product, delivery plan, interface register, agent workflow
```

## Develop

```bash
pnpm install
pnpm dev:web
```

Open the printed local URL in one browser tab or the T3 preview. `dev:web` avoids
opening an additional system-browser tab. Leave Clerk unconfigured for local-only
development; tasks are stored locally without a Worker or cloud database.

```bash
pnpm test
pnpm -r typecheck
pnpm check:boundaries
pnpm check:specs
```

- Mobile/native: `pnpm dev`. For signed-in sync, copy `apps/mobile/.env.example`
  to `apps/mobile/.env` and set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `EXPO_PUBLIC_SYNC_URL` to your configured services.
- Worker: `cd apps/worker && cp .env.example .env && STAGE=dev pnpm deploy`

Requires Node `^24` and pnpm `11.10.0`. Effect is pinned at `4.0.1`; alchemy at `2.0.0-beta.80`;
never-rest at `0.7.0` and neverthrow at `8.2.0`.

Web tabs and previews share one SQLite worker through a SharedWorker broker.
Committed changes refresh other tabs automatically, and writes are serialized
across tabs. The existing OPFS files and unsent edits are preserved. Expo's OPFS
adapter requires a dedicated worker, hosted by one tab; when that tab exits,
remaining tabs automatically reload and reopen committed data. Unsaved form drafts
can be lost during that reconnect. Browsers without SharedWorker retain the
single-tab fallback.

After upgrading from the old single-tab version, close older Yatma tabs once so
the broker can claim their storage lock. Thereafter multiple tabs can stay open.
No Worker deployment, Clerk configuration, or cloud database is required for local
tasks and focus mode. Chat/model requests and signed-in sync need their configured
backend services.

Storage errors keep the workspace closed until its database opens successfully.

The [storage and DX plan](docs/plans/storage-and-dx.md) records the startup fix,
remaining acceptance, and the Turso sync evaluation.

## Product

See [docs/product.md](docs/product.md). Conventions for agents: [AGENTS.md](AGENTS.md).

The active [private-alpha delivery plan](docs/plans/private-alpha.md) records the
remaining integration work and acceptance gates. Read the
[interface register](docs/internals/interfaces.md),
[never-rest guide](docs/development/never-rest.md), and
[sub-agent setup](docs/development/sub-agents.md) before implementing a work item.

The Worker serves health, sync push, and unary turn operations through shared
never-rest contracts. Live sync and turn observation use WebSocket streams.
The delivery plan tracks implementation and acceptance evidence separately.

The [next-build ledger](docs/plans/next-build.md#execution-ledger--2026-11-10)
records the local Chat/Today/player implementation, browser checks and remaining
device/backend gates. `pnpm profile:next-build` reports separate journal/fold and
bounded-presentation measurements. Original ambient loops are bundled locally;
`python3 scripts/generate-ambient-audio.py` regenerates them. Version 0.2.0 adds
the native notification module, so rebuild native development clients when updating.

Current local product direction: Conversation is the planning/query layer (`/list`
and task/project mentions); Today is the selected work stack. Focus is one surface:
desktop splits controls/queue and ambience, while mobile shows full-screen ambience
with bottom controls and the stack below. See the [refinement ledger](docs/plans/next-build.md#product-refinements--2026-11-11)
for implemented behavior, checks, and pending external acceptance.
