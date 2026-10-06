// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  BudgetExceeded,
  ClockSkew,
  InternalError,
  InvalidRequest,
  SpaceRpcGroup,
} from "@yatma/core";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Turn from "./agent/turn.ts";
import * as Usage from "./agent/usage.ts";
import { deleteClerkUser } from "./auth.ts";
import * as Curator from "./curator.ts";
import * as EventStore from "./eventStore.ts";
import * as DetachedTurn from "./proofs/detachedTurn.ts";

type AbortEntry = {
  readonly controller: AbortController;
  readonly chatId: string;
};

/**
 * One Durable Object per Clerk user id.
 * Surface is Effect RPC over hibernating WebSocket (alchemy RpcDurableObject).
 */
export class UserSpace extends Cloudflare.RpcDurableObject<UserSpace>()("UserSpace", {
  schema: SpaceRpcGroup,
}) {}

export const UserSpaceLive = UserSpace.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const model = yield* Config.String("OPENROUTER_MODEL").pipe(
      Config.withDefault("openai/gpt-4o-mini"),
    );
    const openRouterKey = Option.getOrNull(
      yield* Config.option(Config.String("OPENROUTER_API_KEY")),
    );
    const whisperUrl = Option.getOrNull(yield* Config.option(Config.String("WHISPER_API_URL")));
    const whisperKey = Option.getOrNull(yield* Config.option(Config.String("WHISPER_API_KEY")));

    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const sql = SqliteClient.layer({ storage: state.raw.storage });
      const userId = state.raw.id.name ?? state.raw.id.toString();

      yield* EventStore.migrate.pipe(Effect.provide(sql), Effect.orDie);

      const turns = DetachedTurn.createRegistry();
      const aborts = new Map<string, AbortEntry>();

      const idleWrapUp = yield* Alchemy.makeCallback(
        Curator.IDLE_WRAPUP_CALLBACK,
        Effect.fn(function* (payload: { readonly chatId: string }) {
          yield* Curator.executeWrapUp({
            chatId: payload.chatId,
            trigger: "idle_alarm",
            model,
            openRouterKey,
          }).pipe(Effect.provide(sql), Effect.catch(() => Effect.void));
        }),
      );

      function scheduleIdle(chatId: string) {
        return Effect.gen(function* () {
          const plan = Curator.scheduleIdleAlarm({ lastActivityAtMs: Date.now() });
          yield* idleWrapUp.schedule(Curator.idleCallbackId(chatId), {
            at: plan.alarmAtMs,
            payload: { chatId },
          });
          yield* EventStore.setMeta("curator.lastActivityAt", String(Date.now()));
          yield* EventStore.setMeta("curator.pendingChatId", chatId);
        }).pipe(Effect.provide(sql), Effect.catch(() => Effect.void));
      }

      return SpaceRpcGroup.toLayer({
        ping: () =>
          Effect.succeed({
            ok: true as const,
            now: new Date().toISOString(),
          }),

        "sync.push": ({ events }) =>
          Effect.gen(function* () {
            const now = new Date().toISOString();
            const result = yield* EventStore.pushEvents(events, now).pipe(
              Effect.mapError(() => new InternalError({ message: "push_failed" })),
            );
            if (!result.ok) {
              const reject = result.reject;
              if (reject._tag === "clock_skew") {
                return yield* Effect.fail(new ClockSkew({ at: reject.at, now }));
              }
              return yield* Effect.fail(new InvalidRequest({ message: reject.reason }));
            }
            return result.result;
          }).pipe(Effect.provide(sql)),

        "sync.subscribe": ({ after }) =>
          Stream.unwrap(
            EventStore.eventsAfter(after).pipe(
              Effect.provide(sql),
              Effect.map((batch) => Stream.succeed(batch)),
              Effect.mapError(() => new InternalError({ message: "subscribe_failed" })),
              Effect.catch((err) => Effect.succeed(Stream.fail(err))),
            ),
          ),

        "chat.send": (payload) =>
          Stream.unwrap(
            Effect.gen(function* () {
              if (payload.events.length > 0) {
                const now = new Date().toISOString();
                const push = yield* EventStore.pushEvents(payload.events, now).pipe(
                  Effect.provide(sql),
                  Effect.mapError(() => new InternalError({ message: "chat_push_failed" })),
                );
                if (!push.ok) {
                  if (push.reject._tag === "clock_skew") {
                    return yield* Effect.fail(new ClockSkew({ at: push.reject.at, now }));
                  }
                  return yield* Effect.fail(new InvalidRequest({ message: push.reject.reason }));
                }
              }

              const chatId = payload.chatId ?? Turn.newChatId();
              const projectId = payload.projectId;

              const turn = DetachedTurn.startTurn(turns, {
                chatId,
                text: payload.text,
              });
              const controller = new AbortController();
              aborts.set(turn.turnId, { controller, chatId });

              return Turn.runAgentTurn({
                chatId,
                projectId,
                text: payload.text,
                turnId: turn.turnId,
                model,
                openRouterKey,
                signal: controller.signal,
              }).pipe(
                Stream.provide(sql),
                Stream.mapError((err) => {
                  if (err._tag === "BudgetExceeded") {
                    return new BudgetExceeded({ used: err.used, limit: err.limit });
                  }
                  return new InternalError({ message: err.message });
                }),
                Stream.ensuring(
                  Effect.sync(() => {
                    const status = controller.signal.aborted ? "stopped" : "completed";
                    DetachedTurn.completeTurn(turns, turn.turnId, {
                      status: status as "stopped" | "completed",
                    });
                    aborts.delete(turn.turnId);
                  }),
                ),
                Stream.ensuring(scheduleIdle(chatId)),
              );
            }),
          ),

        "chat.stop": ({ turnId, chatId }) =>
          Effect.sync(() => {
            const id =
              turnId ??
              [...aborts.entries()].find(([, entry]) =>
                chatId ? entry.chatId === chatId : true,
              )?.[0] ??
              DetachedTurn.latestTurnId(turns);
            if (id) {
              const entry = aborts.get(id);
              entry?.controller.abort();
              DetachedTurn.stopTurn(turns, id);
              aborts.delete(id);
            }
            return { ok: true as const };
          }),

        "chat.wrapUp": ({ chatId }) =>
          Effect.gen(function* () {
            const result = yield* Curator.executeWrapUp({
              chatId,
              trigger: "user",
              model,
              openRouterKey,
            }).pipe(Effect.mapError(() => new InternalError({ message: "wrap_up_failed" })));
            yield* scheduleIdle(chatId);
            return result;
          }).pipe(Effect.provide(sql)),

        "account.delete": () =>
          Effect.gen(function* () {
            yield* EventStore.clearAll;
            DetachedTurn.clearRegistry(turns);
            aborts.clear();
            yield* state.storage.deleteAll();
            yield* deleteClerkUser(userId).pipe(Effect.ignore);
            return { ok: true as const };
          }).pipe(Effect.provide(sql), Effect.orDie),

        transcribe: (payload) =>
          Effect.gen(function* () {
            // Prefer Workers AI binding when present on the DO env.
            const ai = (
              state.raw as {
                env?: { AI?: { run: (model: string, input: unknown) => Promise<unknown> } };
              }
            ).env?.AI;
            if (ai && typeof ai.run === "function") {
              const binary = Uint8Array.from(atob(payload.audioBase64), (c) => c.charCodeAt(0));
              const result = yield* Effect.tryPromise({
                try: () =>
                  ai.run("@cf/openai/whisper", {
                    audio: [...binary],
                  }) as Promise<{ text?: string }>,
                catch: (cause) =>
                  new InternalError({
                    message: `workers_ai_whisper_failed: ${String(cause)}`,
                  }),
              });
              return { text: result.text ?? "" };
            }

            if (!whisperUrl) {
              // TODO: wire Cloudflare Workers AI Whisper binding in alchemy deploy.
              return yield* Effect.fail(
                new InternalError({
                  message:
                    "transcribe unavailable: no AI binding and WHISPER_API_URL unset",
                }),
              );
            }

            const mimeType = payload.mimeType ?? "audio/m4a";
            const apiKey = whisperKey ?? openRouterKey;
            return yield* Effect.tryPromise({
              try: async () => {
                const bytes = Uint8Array.from(atob(payload.audioBase64), (c) =>
                  c.charCodeAt(0),
                );
                const form = new FormData();
                form.append(
                  "file",
                  new Blob([bytes], { type: mimeType }),
                  "audio.m4a",
                );
                form.append("model", "whisper-1");
                const headers: Record<string, string> = {};
                if (apiKey) headers.authorization = `Bearer ${apiKey}`;
                const res = await fetch(whisperUrl, { method: "POST", headers, body: form });
                if (!res.ok) throw new Error(`http_${res.status}`);
                const json = (await res.json()) as { text?: string };
                return { text: json.text ?? "" };
              },
              catch: (cause) =>
                new InternalError({ message: `whisper_fetch_failed: ${String(cause)}` }),
            });
          }),

        "usage.get": () =>
          Usage.getUsage(sql).pipe(
            Effect.mapError(() => new InternalError({ message: "usage_read_failed" })),
          ),
      }).pipe(Layer.provide(sql));
    });
  }),
);
