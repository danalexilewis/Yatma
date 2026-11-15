import * as Semaphore from "effect/Semaphore";
import * as ReviewSchedule from "./application/reviewSchedule.ts";
import * as Gmail from "./application/gmail.ts";
import * as Intake from "./application/intake.ts";
// Copyright (c) T3 Tools / MIT — adapted for Yatma
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import {
  ClockSkew,
  InternalError,
  InvalidRequest,
  NotFound,
  SpaceRpcGroup,
  supportsSyncEvents,
} from "@yatma/core";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Turn from "./agent/turn.ts";
import * as Supervisor from "./agent/supervisor.ts";
import * as Usage from "./agent/usage.ts";
import * as AccountDeletion from "./application/accountDeletion.ts";
import * as Mutations from "./application/mutations.ts";
import { deleteClerkUser } from "./auth.ts";
import * as Curator from "./curator.ts";
import * as EventStore from "./eventStore.ts";

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

    const gmailClientId = Option.getOrNull(yield* Config.option(Config.String("GMAIL_CLIENT_ID")));
    const gmailClientSecret = Option.getOrNull(
      yield* Config.option(Config.String("GMAIL_CLIENT_SECRET")),
    );
    const gmailRedirectUri = Option.getOrNull(
      yield* Config.option(Config.String("GMAIL_REDIRECT_URI")),
    );
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const sql = SqliteClient.layer({ storage: state.raw.storage });
      const userId = state.raw.id.name ?? state.raw.id.toString();

      yield* EventStore.migrate.pipe(Effect.provide(sql), Effect.orDie);
      yield* Usage.migrate.pipe(Effect.provide(sql), Effect.orDie);
      yield* Gmail.migrate.pipe(Effect.provide(sql), Effect.orDie);
      yield* ReviewSchedule.migrate.pipe(Effect.provide(sql), Effect.orDie);
      yield* Supervisor.migrate.pipe(Effect.provide(sql), Effect.orDie);
      yield* AccountDeletion.migrate.pipe(Effect.provide(sql), Effect.orDie);

      const ensureAccountActive = () =>
        Effect.gen(function* () {
          const deletion = yield* AccountDeletion.getStatus(userId);
          if (deletion) {
            return yield* Effect.fail(
              new InternalError({ message: "account_deletion_in_progress" }),
            );
          }
        }).pipe(
          Effect.provide(sql),
          Effect.mapError(() => new InternalError({ message: "account_status_failed" })),
        );

      function ensureEventReader(version: number | undefined) {
        return supportsSyncEvents(version)
          ? Effect.void
          : Effect.fail(new InvalidRequest({ message: "upgrade_required" }));
      }

      const commitHub = yield* Mutations.makeCommitHub;
      const mutations = Mutations.makeMutationService(commitHub, ensureAccountActive);
      const reviewLock = yield* Semaphore.make(1);
      const gmailLock = yield* Semaphore.make(1);
      const gmail = Gmail.makeGmailService(
        gmailClientId && gmailClientSecret && gmailRedirectUri
          ? {
              clientId: gmailClientId,
              clientSecret: gmailClientSecret,
              redirectUri: gmailRedirectUri,
            }
          : null,
        ensureAccountActive,
        (message) => Intake.receiveGmailMessage(message, mutations),
      );
      const reviewCallback: Alchemy.Callback<{ readonly version: string }> =
        yield* Alchemy.makeCallback(
          ReviewSchedule.REVIEW_CALLBACK,
          (payload: { readonly version: string }) =>
            reviewLock.withPermits(1)(
              Effect.gen(function* () {
                if (yield* AccountDeletion.getStatus(userId)) return;
                const result = yield* ReviewSchedule.publishDueReview(
                  payload.version,
                  Date.now(),
                  mutations,
                );
                if (result.nextAt !== null)
                  yield* reviewCallback.schedule(ReviewSchedule.REVIEW_CALLBACK_ID, {
                    at: result.nextAt,
                    payload: { version: result.version },
                  });
              }).pipe(Effect.provide(sql)),
            ),
        );
      // Reconcile persisted preferences after a restart, including an overdue invitation.
      yield* Effect.gen(function* () {
        if (yield* AccountDeletion.getStatus(userId)) return;
        const saved = yield* ReviewSchedule.readSchedule;
        if (!saved.enabled) {
          yield* reviewCallback.cancel(ReviewSchedule.REVIEW_CALLBACK_ID);
          return;
        }
        yield* reviewCallback.schedule(ReviewSchedule.REVIEW_CALLBACK_ID, {
          at: Date.now() + 1,
          payload: { version: saved.version },
        });
      }).pipe(Effect.provide(sql), Effect.orDie);
      function reviewOperation<A, E, R>(operation: Effect.Effect<A, E, R>) {
        return reviewLock
          .withPermits(1)(ensureAccountActive().pipe(Effect.andThen(operation)))
          .pipe(Effect.mapError(() => new InternalError({ message: "review_operation_failed" })));
      }
      function gmailOperation<A, E, R>(operation: Effect.Effect<A, E, R>) {
        return gmailLock
          .withPermits(1)(operation)
          .pipe(Effect.mapError(() => new InternalError({ message: "gmail_operation_failed" })));
      }
      const supervisor = yield* Supervisor.makeSupervisor<RuntimeContext>({
        sqlLayer: sql,
        mutations,
        model,
        openRouterKey,
        scheduleBackground: (work) => state.waitUntil(work),
      });
      yield* supervisor.recover;

      const idleWrapUp = yield* Alchemy.makeCallback(
        Curator.IDLE_WRAPUP_CALLBACK,
        (payload: { readonly chatId: string }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            const currentChatId = yield* EventStore.getMeta("curator.pendingChatId");
            if (currentChatId !== payload.chatId) return;
            yield* Curator.executeWrapUp({
              chatId: payload.chatId,
              trigger: "idle_alarm",
              model,
              openRouterKey,
              mutations,
            });
          }).pipe(
            Effect.provide(sql),
            Effect.catch(() => Effect.void),
          ),
      );

      function scheduleIdle(chatId: string) {
        return Effect.gen(function* () {
          const previousChatId = yield* EventStore.getMeta("curator.pendingChatId");
          if (previousChatId && previousChatId !== chatId) {
            yield* idleWrapUp.cancel(Curator.idleCallbackId(previousChatId));
          }
          const plan = Curator.scheduleIdleAlarm({ lastActivityAtMs: Date.now() });
          yield* idleWrapUp.schedule(Curator.idleCallbackId(chatId), {
            at: plan.alarmAtMs,
            payload: { chatId },
          });
          yield* EventStore.setMeta("curator.lastActivityAt", String(Date.now()));
          yield* EventStore.setMeta("curator.pendingChatId", chatId);
        }).pipe(
          Effect.provide(sql),
          Effect.catch(() => Effect.void),
        );
      }

      return SpaceRpcGroup.toLayer({
        "review.schedule.get": () => reviewOperation(ReviewSchedule.readSchedule),
        "review.schedule.set": (input) =>
          reviewOperation(
            Effect.gen(function* () {
              const saved = yield* ReviewSchedule.saveSchedule(input);
              const at = ReviewSchedule.nextReviewOccurrence(saved, Date.now());
              if (at === null) yield* reviewCallback.cancel(ReviewSchedule.REVIEW_CALLBACK_ID);
              else
                yield* reviewCallback.schedule(ReviewSchedule.REVIEW_CALLBACK_ID, {
                  at,
                  payload: { version: saved.version },
                });
              return saved;
            }),
          ),
        "gmail.status": () => gmailOperation(gmail.status),
        "gmail.begin": () => gmailOperation(gmail.begin),
        "gmail.complete": (input) => gmailOperation(gmail.complete(input)),
        "gmail.import": (input) => gmailOperation(gmail.importMessages(input)),
        "gmail.disconnect": () => gmailOperation(gmail.disconnect),
        ping: () =>
          Effect.succeed({
            ok: true as const,
            now: new Date().toISOString(),
          }),

        "sync.push": ({ events, deviceId, eventSchemaVersion }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            if (!supportsSyncEvents(eventSchemaVersion)) {
              return yield* Effect.fail(new InvalidRequest({ message: "upgrade_required" }));
            }
            const now = new Date().toISOString();
            if (
              events.some(
                (event) =>
                  event.by.kind !== "user" ||
                  event.by.deviceId !== deviceId ||
                  (event.type === "review.received" && event.item.source === "gmail"),
              )
            ) {
              return yield* Effect.fail(new InvalidRequest({ message: "invalid_event_actor" }));
            }
            const result = yield* mutations.pushIncomingBatch(events, now).pipe(
              Effect.provide(sql),
              Effect.mapError(() => new InternalError({ message: "push_failed" })),
            );
            if (!result.ok) {
              const reject = result.reject;
              if (reject._tag === "clock_skew") {
                return yield* Effect.fail(new ClockSkew({ at: reject.at, now }));
              }
              if (reject._tag === "event_conflict") {
                return yield* Effect.fail(new InvalidRequest({ message: "event_conflict" }));
              }
              return yield* Effect.fail(new InvalidRequest({ message: reject.reason }));
            }
            return result.result;
          }).pipe(Effect.provide(sql)),

        "sync.subscribe": ({ after, eventSchemaVersion }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* ensureAccountActive();
              if (!supportsSyncEvents(eventSchemaVersion)) {
                return yield* Effect.fail(new InvalidRequest({ message: "upgrade_required" }));
              }
              return mutations.observeAfter(after).pipe(
                Stream.provide(sql),
                Stream.mapError(() => new InternalError({ message: "subscribe_failed" })),
              );
            }),
          ),

        "chat.send": (payload) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* ensureAccountActive();
              yield* ensureEventReader(payload.eventSchemaVersion);
              if (
                payload.events.some(
                  (event) =>
                    event.by.kind !== "user" ||
                    (event.type === "review.received" && event.item.source === "gmail"),
                )
              ) {
                return yield* Effect.fail(new InvalidRequest({ message: "invalid_event_actor" }));
              }

              const chatId = payload.chatId ?? Turn.newChatId();
              const projectId = payload.projectId;

              const receipt = yield* supervisor
                .start({
                  requestId: crypto.randomUUID(),
                  messageId: `msg_${crypto.randomUUID()}`,
                  chatId,
                  projectId,
                  text: payload.text,
                  events: payload.events,
                })
                .pipe(Effect.mapError((err) => new InvalidRequest({ message: String(err) })));
              yield* scheduleIdle(receipt.chatId);
              return supervisor.observe(receipt.turnId, 0).pipe(
                Stream.map((frame) => frame.item),
                Stream.mapError(() => new InternalError({ message: "turn_observe_failed" })),
              );
            }),
          ),

        "turn.start": ({
          requestId,
          messageId,
          chatId,
          projectId,
          text,
          events,
          eventSchemaVersion,
        }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            yield* ensureEventReader(eventSchemaVersion);
            if (
              events.some(
                (event) =>
                  event.by.kind !== "user" ||
                  (event.type === "review.received" && event.item.source === "gmail"),
              )
            ) {
              return yield* Effect.fail(new InvalidRequest({ message: "invalid_event_actor" }));
            }
            const receipt = yield* supervisor
              .start({
                requestId,
                messageId,
                ...(chatId ? { chatId } : {}),
                projectId,
                text,
                events,
              })
              .pipe(Effect.mapError((err) => new InvalidRequest({ message: String(err) })));
            yield* scheduleIdle(receipt.chatId);
            return receipt;
          }),

        "turn.get": ({ turnId, eventSchemaVersion }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            yield* ensureEventReader(eventSchemaVersion);
            const result = yield* supervisor
              .get(turnId)
              .pipe(Effect.mapError(() => new InternalError({ message: "turn_read_failed" })));
            if (!result) return yield* Effect.fail(new NotFound({ entity: "turn", id: turnId }));
            return result;
          }),

        "turn.stop": ({ turnId }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            const result = yield* supervisor
              .stop(turnId)
              .pipe(Effect.mapError(() => new InternalError({ message: "turn_stop_failed" })));
            if (!result.found)
              return yield* Effect.fail(new NotFound({ entity: "turn", id: turnId }));
            return { ok: true as const };
          }),

        "turn.observe": ({ turnId, after, eventSchemaVersion }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* ensureAccountActive();
              yield* ensureEventReader(eventSchemaVersion);
              return supervisor.observe(turnId, after).pipe(
                Stream.provide(sql),
                Stream.mapError(() => new InternalError({ message: "turn_observe_failed" })),
              );
            }),
          ),

        "chat.stop": ({ turnId, chatId }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            if (turnId)
              yield* supervisor
                .stop(turnId)
                .pipe(Effect.mapError(() => new InternalError({ message: "turn_stop_failed" })));
            void chatId;
            return { ok: true as const };
          }),

        "chat.wrapUp": ({ chatId, eventSchemaVersion }) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
            yield* ensureEventReader(eventSchemaVersion);
            const result = yield* Curator.executeWrapUp({
              chatId,
              trigger: "user",
              model,
              openRouterKey,
              mutations,
            }).pipe(Effect.mapError(() => new InternalError({ message: "wrap_up_failed" })));
            yield* scheduleIdle(chatId);
            return result;
          }).pipe(Effect.provide(sql)),

        "account.delete": () =>
          Effect.gen(function* () {
            const deletion = yield* gmailLock
              .withPermits(1)(
                reviewLock.withPermits(1)(
                  Effect.gen(function* () {
                    const previous = yield* AccountDeletion.getStatus(userId);
                    if (!previous) yield* gmail.disconnect;
                    yield* reviewCallback.cancel(ReviewSchedule.REVIEW_CALLBACK_ID);
                    return yield* commitHub.exclusive(AccountDeletion.beginOrRead(userId));
                  }),
                ),
              )
              .pipe(
                Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
              );
            if (deletion?.status === "completed") {
              yield* state.storage
                .deleteAll()
                .pipe(
                  Effect.mapError(
                    () => new InternalError({ message: "account_delete_incomplete" }),
                  ),
                );
              return { ok: true as const };
            }
            if (!deletion)
              return yield* Effect.fail(
                new InternalError({ message: "account_delete_incomplete" }),
              );
            const pendingChatId = yield* EventStore.getMeta("curator.pendingChatId").pipe(
              Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
            );
            if (pendingChatId) {
              yield* idleWrapUp
                .cancel(Curator.idleCallbackId(pendingChatId))
                .pipe(
                  Effect.mapError(
                    () => new InternalError({ message: "account_delete_incomplete" }),
                  ),
                );
            }
            yield* supervisor.stopAll.pipe(
              Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
            );
            yield* EventStore.clearAll.pipe(
              Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
            );
            const clerk = yield* deleteClerkUser(userId).pipe(Effect.result);
            if (clerk._tag === "Failure" || (!clerk.success.deleted && userId !== "user_test")) {
              yield* AccountDeletion.markRemoteFailure(
                userId,
                deletion.requestId,
                "clerk_delete_failed",
              );
              return yield* Effect.fail(new InternalError({ message: "clerk_delete_unavailable" }));
            }
            yield* AccountDeletion.markRemoteComplete(userId, deletion.requestId);
            yield* state.storage
              .deleteAll()
              .pipe(
                Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
              );
            return { ok: true as const };
          }).pipe(
            Effect.provide(sql),
            Effect.mapError(() => new InternalError({ message: "account_delete_incomplete" })),
          ),

        transcribe: (payload) =>
          Effect.gen(function* () {
            yield* ensureAccountActive();
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
                  message: "transcribe unavailable: no AI binding and WHISPER_API_URL unset",
                }),
              );
            }

            const mimeType = payload.mimeType ?? "audio/m4a";
            const apiKey = whisperKey ?? openRouterKey;
            return yield* Effect.tryPromise({
              try: async () => {
                const bytes = Uint8Array.from(atob(payload.audioBase64), (c) => c.charCodeAt(0));
                const form = new FormData();
                form.append("file", new Blob([bytes], { type: mimeType }), "audio.m4a");
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
          ensureAccountActive().pipe(
            Effect.andThen(Usage.getUsage(sql)),
            Effect.mapError(() => new InternalError({ message: "usage_read_failed" })),
          ),
      }).pipe(Layer.provide(sql));
    });
  }),
);
