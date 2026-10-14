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
pnpm test
pnpm -r typecheck
```

- Mobile: `pnpm --filter @yatma/mobile dev` (set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SYNC_URL`)
- Worker: `cd apps/worker && cp .env.example .env && STAGE=dev pnpm deploy`

Requires Node `^24` and pnpm `11.10.0`. Effect is pinned at `4.0.1`; alchemy at `2.0.0-beta.80`;
never-rest at `0.7.0` and neverthrow at `8.2.0`.

## Product

See [docs/product.md](docs/product.md). Conventions for agents: [AGENTS.md](AGENTS.md).

The active [private-alpha delivery plan](docs/plans/private-alpha.md) records the
remaining integration work and acceptance gates. Read the
[interface register](docs/internals/interfaces.md),
[never-rest guide](docs/development/never-rest.md), and
[sub-agent setup](docs/development/sub-agents.md) before implementing a work item.

The Worker now serves `GET /` and `GET /health` through the shared health
contract. The sync contract is declared for the next adapter step; its HTTP
route is not yet mounted. Existing WebSocket RPC remains during migration.
