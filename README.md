# Yatma

Yet Another Task Management App — iOS-first tasks by touch or chat, with a local-first event log synced to a per-user Cloudflare Durable Object (`UserSpace`).

## Monorepo layout

```
apps/mobile/     Expo Router app (Clerk, SQLite, sync, chat)
apps/worker/     Cloudflare Worker + UserSpace Durable Object (alchemy)
packages/core/   Effect-only schemas, fold, rules, RPC, tools, buildContext
docs/            product.md and internals (sync, agent, architecture)
```

## Develop

```bash
pnpm install
pnpm test
pnpm -r typecheck
```

- Mobile: `pnpm --filter @yatma/mobile dev` (set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SYNC_URL`)
- Worker: `cd apps/worker && cp .env.example .env && STAGE=dev pnpm deploy`

Requires Node `^24` and pnpm `11.10.0`. Effect is pinned at `4.0.1`; alchemy at `2.0.0-beta.80`.

## Product

See [docs/product.md](docs/product.md). Conventions for agents: [AGENTS.md](AGENTS.md).
