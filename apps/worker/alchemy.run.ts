// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import ApiLive, { Api } from "./src/worker.ts";

/**
 * Yatma Worker stack. Stages via `STAGE=dev|testers` (Alchemy default).
 * Deploy: `cd apps/worker && STAGE=dev pnpm deploy`
 */
export default Alchemy.Stack(
  "Yatma",
  {
    providers: Layer.mergeAll(Cloudflare.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* Api;
    return {
      workerName: api.workerName,
      url: api.url,
    };
  }).pipe(Effect.provide(ApiLive)),
);
