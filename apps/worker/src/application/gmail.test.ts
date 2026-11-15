import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as NodeSqlite from "../testing/nodeSqlite.ts";
import { makeGmailService, migrate, type GmailMessage } from "./gmail.ts";

const config = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://app.example/gmail-callback",
};
const scope = "https://www.googleapis.com/auth/gmail.readonly";
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Gmail connection and import", () => {
  it.effect("binds state once, imports bounded metadata and revokes server credentials", () =>
    Effect.gen(function* () {
      yield* migrate;
      const received: GmailMessage[] = [];
      const calls: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/token"))
          return json({ access_token: "access", refresh_token: "refresh", scope });
        if (url.endsWith("/profile")) return json({ emailAddress: "person@example.com" });
        if (url.includes("/messages?")) {
          expect(url).toContain("maxResults=20");
          return json({ messages: [{ id: "abc" }], nextPageToken: "next" });
        }
        if (url.includes("/messages/abc"))
          return json({
            id: "abc",
            historyId: "123",
            snippet: "Please review",
            payload: {
              headers: [
                { name: "Subject", value: "Request" },
                { name: "From", value: "Sender" },
              ],
            },
          });
        if (url.endsWith("/revoke")) {
          expect(String(init?.body)).toContain("refresh");
          return new Response(null, { status: 200 });
        }
        throw new Error("Unexpected URL");
      };
      const service = makeGmailService(
        config,
        () => Effect.void,
        (message) =>
          Effect.sync(() => {
            received.push(message);
          }),
        fetcher,
      );
      const started = yield* service.begin;
      const authorization = new URL(started.authorizationUrl);
      expect(authorization.searchParams.get("scope")).toBe(scope);
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(
        Result.isFailure(yield* Effect.result(service.complete({ code: "code", state: "wrong" }))),
      ).toBe(true);
      const state = authorization.searchParams.get("state")!;
      expect((yield* service.complete({ code: "code", state })).connected).toBe(true);
      expect(
        Result.isFailure(yield* Effect.result(service.complete({ code: "code", state }))),
      ).toBe(true);
      expect(yield* service.importMessages({})).toEqual({ received: 1, nextPageToken: "next" });
      expect(received[0]?.email).toBe("person@example.com");
      expect(received[0]?.historyId).toBe("123");
      expect(yield* service.disconnect).toEqual({ connected: false });
      expect((yield* service.status).connected).toBe(false);
      expect(Result.isFailure(yield* Effect.result(service.importMessages({})))).toBe(true);
      expect(calls.filter((url) => url.endsWith("/revoke"))).toHaveLength(1);
    }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
  );

  it.effect("keeps failed revocation retryable while stopping imports", () =>
    Effect.gen(function* () {
      yield* migrate;
      let failRevoke = true;
      const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/token"))
          return json({ access_token: "access", refresh_token: "refresh", scope });
        if (url.endsWith("/profile")) return json({ emailAddress: "person@example.com" });
        if (url.endsWith("/revoke")) return new Response(null, { status: failRevoke ? 500 : 200 });
        throw new Error("Unexpected URL");
      };
      const service = makeGmailService(
        config,
        () => Effect.void,
        () => Effect.void,
        fetcher,
      );
      const start = yield* service.begin;
      yield* service.complete({
        code: "code",
        state: new URL(start.authorizationUrl).searchParams.get("state")!,
      });
      expect(Result.isFailure(yield* Effect.result(service.disconnect))).toBe(true);
      expect((yield* service.status).connected).toBe(false);
      expect(Result.isFailure(yield* Effect.result(service.importMessages({})))).toBe(true);
      failRevoke = false;
      yield* service.disconnect;
      expect((yield* service.status).email).toBeNull();
    }).pipe(Effect.provide(NodeSqlite.layer({ filename: ":memory:" }))),
  );
});
