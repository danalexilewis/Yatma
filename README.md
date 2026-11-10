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
```

- Mobile/native: `pnpm dev`. For signed-in sync, copy `apps/mobile/.env.example`
  to `apps/mobile/.env` and set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `EXPO_PUBLIC_SYNC_URL` to your configured services.
- Worker: `cd apps/worker && cp .env.example .env && STAGE=dev pnpm deploy`

Requires Node `^24` and pnpm `11.10.0`. Effect is pinned at `4.0.1`; alchemy at `2.0.0-beta.80`;
never-rest at `0.7.0` and neverthrow at `8.2.0`.

If web startup reports that Yatma is open elsewhere, close other Yatma tabs and
windows on that origin, then choose **Reload**. Expo SQLite's web file pool has
one owner per origin, across all account databases. Reload any older tabs after
updating this code. This recovery preserves local data and unsent edits; clearing
browser storage is unnecessary for a file-lock failure. Storage errors keep the
workspace closed until its database opens successfully.

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
