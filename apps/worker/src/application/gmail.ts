import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export type GmailConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
};
export type GmailMessage = {
  readonly id: string;
  readonly historyId: string;
  readonly subject: string;
  readonly snippet: string;
  readonly sender: string;
  readonly email: string;
};
type Connection = {
  readonly generation: string;
  readonly state?: string;
  readonly verifier?: string;
  readonly stateExpiresAt?: number;
  readonly refreshToken?: string;
  readonly email?: string;
};
export type GmailFailure = { readonly _tag: "GmailFailure"; readonly message: string };
function failure(message: string): GmailFailure {
  return { _tag: "GmailFailure", message };
}
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE IF NOT EXISTS gmail_connection (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
  );
});

const readConnection = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    payload: string;
  }>`SELECT payload FROM gmail_connection WHERE id = 'default'`;
  return rows[0] ? (JSON.parse(rows[0].payload) as Connection) : null;
});
function writeConnection(connection: Connection) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO gmail_connection (id,payload) VALUES ('default',${JSON.stringify(connection)}) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`;
  });
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Account-scoped OAuth and read-only import; secrets stay in the private DO database. */
export function makeGmailService<E, R, IE, IR>(
  config: GmailConfig | null,
  ensureActive: () => Effect.Effect<void, E, R>,
  receive: (message: GmailMessage) => Effect.Effect<unknown, IE, IR>,
  fetcher: typeof fetch = fetch,
) {
  function request(url: string, init?: RequestInit) {
    return Effect.tryPromise({
      try: async () => {
        const response = await fetcher(url, init);
        if (!response.ok)
          throw failure(
            response.status === 401 || response.status === 400
              ? "Reconnect Gmail and try again."
              : "Gmail is temporarily unavailable. Retry the import.",
          );
        return object(await response.json());
      },
      catch: (error) =>
        object(error)._tag === "GmailFailure"
          ? (error as GmailFailure)
          : failure("Gmail is temporarily unavailable. Retry the import."),
    });
  }
  function token(body: Record<string, string>) {
    return request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...body,
        client_id: config!.clientId,
        client_secret: config!.clientSecret,
      }),
    });
  }
  const status = Effect.gen(function* () {
    yield* ensureActive();
    const connection = yield* readConnection;
    return {
      configured: !!config,
      connected: !!connection?.refreshToken && !connection.generation.startsWith("revoking:"),
      email: connection?.email ?? null,
    };
  });
  const begin = Effect.gen(function* () {
    yield* ensureActive();
    if (!config)
      return yield* Effect.fail(failure("Gmail OAuth is not configured on this server."));
    const existing = yield* readConnection;
    if (existing?.refreshToken)
      return yield* Effect.fail(
        failure("Disconnect the existing Gmail account before connecting again."),
      );
    const state = encode(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = yield* Effect.promise(async () =>
      encode(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
      ),
    );
    yield* writeConnection({
      generation: crypto.randomUUID(),
      state,
      verifier,
      stateExpiresAt: Date.now() + 10 * 60_000,
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizationUrl: url.toString() };
  });
  const complete = Effect.fn("Gmail.complete")(function* (input: { code: string; state: string }) {
    yield* ensureActive();
    if (!config)
      return yield* Effect.fail(failure("Gmail OAuth is not configured on this server."));
    const connection = yield* readConnection;
    if (
      !connection ||
      !connection.state ||
      connection.state !== input.state ||
      !connection.verifier ||
      (connection.stateExpiresAt ?? 0) < Date.now()
    )
      return yield* Effect.fail(failure("This Gmail connection request expired. Start again."));
    const sql = yield* SqlClient.SqlClient;
    const consumed = yield* sql<{
      id: string;
    }>`UPDATE gmail_connection SET payload = ${JSON.stringify({ generation: connection.generation })} WHERE id = 'default' AND payload = ${JSON.stringify(connection)} RETURNING id`;
    if (!consumed.length)
      return yield* Effect.fail(failure("This Gmail connection request was already used."));
    const result = yield* token({
      code: input.code,
      code_verifier: connection.verifier,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
    const accessToken = text(result.access_token);
    const refreshToken = text(result.refresh_token);
    if (!accessToken || !refreshToken || !text(result.scope).split(" ").includes(SCOPE))
      return yield* Effect.fail(failure("Gmail read access was not granted. Connect again."));
    const profile = yield* request("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const email = text(profile.emailAddress);
    if (!email) return yield* Effect.fail(failure("Gmail did not return an account identity."));
    yield* ensureActive();
    const updated = yield* sql<{
      id: string;
    }>`UPDATE gmail_connection SET payload = ${JSON.stringify({ generation: connection.generation, refreshToken, email })} WHERE id = 'default' AND payload = ${JSON.stringify({ generation: connection.generation })} RETURNING id`;
    if (!updated.length)
      return yield* Effect.fail(failure("Gmail connection was cancelled. Connect again."));
    return { connected: true, email };
  });
  const importMessages = Effect.fn("Gmail.import")(function* (input: {
    pageToken?: string | undefined;
  }) {
    yield* ensureActive();
    const connection = yield* readConnection;
    if (
      !config ||
      !connection?.refreshToken ||
      !connection.email ||
      connection.generation.startsWith("revoking:")
    )
      return yield* Effect.fail(failure("Connect Gmail before importing messages."));
    const refreshed = yield* token({
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    const accessToken = text(refreshed.access_token);
    if (!accessToken) return yield* Effect.fail(failure("Reconnect Gmail and try again."));
    const headers = { Authorization: `Bearer ${accessToken}` };
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.search = new URLSearchParams({
      maxResults: "20",
      labelIds: "INBOX",
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    }).toString();
    const page = yield* request(url.toString(), { headers });
    const messages = Array.isArray(page.messages) ? page.messages.slice(0, 20) : [];
    let received = 0;
    for (const entry of messages) {
      const id = text(object(entry).id);
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
      const message = yield* request(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        { headers },
      );
      const rawHeaders = object(message.payload).headers;
      const messageHeaders = Array.isArray(rawHeaders) ? rawHeaders.map(object) : [];
      function header(name: string) {
        return text(
          messageHeaders.find((h) => text(h.name).toLowerCase() === name.toLowerCase())?.value,
        );
      }
      yield* ensureActive();
      const latest = yield* readConnection;
      if (latest?.generation !== connection.generation || !latest.refreshToken)
        return yield* Effect.fail(failure("Gmail was disconnected. Import stopped."));
      yield* receive({
        id,
        historyId: /^\d+$/.test(text(message.historyId)) ? text(message.historyId) : "0",
        subject: (header("Subject").trim() || "(No subject)").slice(0, 200),
        sender: header("From").slice(0, 500),
        snippet: text(message.snippet).slice(0, 2000),
        email: connection.email,
      });
      received++;
    }
    return { received, nextPageToken: text(page.nextPageToken) || null };
  });
  const disconnect = Effect.gen(function* () {
    yield* ensureActive();
    const connection = yield* readConnection;
    const sql = yield* SqlClient.SqlClient;
    // Invalidate running imports and pending authorizations before network revocation.
    if (connection)
      yield* writeConnection({
        generation: `revoking:${crypto.randomUUID()}`,
        ...(connection.refreshToken ? { refreshToken: connection.refreshToken } : {}),
        ...(connection.email ? { email: connection.email } : {}),
      });
    if (connection?.refreshToken) {
      yield* Effect.tryPromise({
        try: async () => {
          const response = await fetcher("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: connection.refreshToken! }),
          });
          if (!response.ok && response.status !== 400) throw new Error("revocation failed");
        },
        catch: () => failure("Gmail revocation failed. Retry disconnect to remove access."),
      });
    }
    yield* sql`DELETE FROM gmail_connection WHERE id = 'default' AND payload LIKE '%revoking:%'`;
    return { connected: false as const };
  });
  return { status, begin, complete, importMessages, disconnect };
}
