# Gmail and scheduled review setup

Status: local implementation and scripted tests, 2026-11-11. Real Google OAuth,
mailbox import and deployed Durable Object callbacks require the acceptance steps
below. The feature plan is [conversation prioritisation](../plans/conversation-prioritisation.md).

## Gmail configuration

1. In a Google Cloud project, enable the Gmail API and configure the OAuth consent
   screen. During testing, add the intended Google accounts as test users.
2. Create an OAuth **Web application** client. Register the exact deployed app URL
   ending in `/gmail-callback` as an authorized redirect URI, for example
   `https://app.example.com/gmail-callback`. This is an app route; it is not a
   Worker API callback. The signed-in app submits the returned code/state to the
   authenticated Worker completion operation.
3. Configure the Worker deployment with:

   | Variable | Value |
   | --- | --- |
   | `GMAIL_CLIENT_ID` | Google OAuth web client ID |
   | `GMAIL_CLIENT_SECRET` | OAuth client secret, supplied as a deployment secret |
   | `GMAIL_REDIRECT_URI` | The exact registered app callback URL |

   Existing app configuration must point at that Worker and use its existing
   authenticated session. Keep the secret out of Expo public environment
   variables, source control, and browser code. Without all three values the
   status endpoint reports Gmail as unconfigured.
4. Open Conversation's integration controls, choose Connect Gmail, grant access,
   and finish connecting on the callback page while signed in to the same Yatma
   account. A connection request expires after ten minutes and can be consumed
   only once. Start again after denial or expiry.
5. Import inbox messages. Each request reads at most 20 messages and reports a
   continuation token for another page. Received items appear in Needs review;
   the user decides whether to create a task or add work to Today.

The requested scope is `https://www.googleapis.com/auth/gmail.readonly`.
The adapter reads inbox message identities, Subject/From metadata and snippets.
It does not change labels, mark mail read, send replies or write back decisions.
OAuth grants read access to the mailbox; the current product import is bounded
to inbox pages. Source links open the original mailbox/message. Reimporting a
message reuses mailbox address + message ID identity and compares decimal Gmail
history revisions; it preserves the user's review disposition.

Tokens live in the account's private `gmail_connection` Durable Object SQL table,
outside the shared event journal and sync/export payload. Pending authorization
uses a random state and PKCE verifier. Access tokens are short-lived local
variables; the server stores the refresh token. Provider content remains source
material and does not authorize model actions.

## Disconnect and permission changes

Disconnect invalidates pending authorization/imports, calls Google's revocation
endpoint, then removes private credentials. If revocation fails, the connection
stays disabled with its token retained for a disconnect retry. Account deletion
must complete this cleanup before deleting local credential storage. Existing
imported items remain until the user's ordinary workspace/account deletion.

If permission is removed in Google Account settings, a later refresh/import can
fail. Disconnect and connect again to grant access. Do not retry imports endlessly
against unchanged revoked credentials. Changing Google accounts requires
Disconnect before Connect; source identity keeps each mailbox distinct.

## Scheduled reviews

Reviews are disabled until configured. Choose a local time and IANA timezone.
The Worker persists the preference and uses the existing Alchemy callback
scheduler, alongside idle curation. The callback publishes a durable thread
invitation without calling the model or adding daily work. A date-stable message
identity deduplicates retries. Missed dates coalesce into the current day. A
nonexistent spring DST time runs at the next available local minute; a repeated
fall DST time yields at most one invitation for that date.

Push notifications are not required for delivery. The journal carries the
invitation to clients when they next sync. Updating/pausing the schedule must
serialize with callback publication and account deletion.

## Real acceptance checklist

- Use a configured test Google account to connect and verify the callback route
  works with the application's real authentication/session on desktop and mobile.
- Import a page, follow a continuation page, then repeat the first page. Confirm
  no duplicate review items/tasks, visible provenance and no automatic Today
  changes. Confirm choosing an imported item creates the intended linked task.
- Disconnect, verify further imports fail, reconnect and verify existing source
  identity is reused. Revoke permission in Google settings and exercise recovery.
- Inspect responses and exported event history to confirm OAuth tokens are absent.
- Enable a near-future review, close clients, let the deployed callback run, then
  reopen and sync. Confirm one invitation and no automatic plan changes.
- Restart/evict the Durable Object around publication; verify retry/rearm, pause,
  timezone changes, account deletion and coexisting idle curation.

Local fake-provider and SQLite fixtures are evidence for the application policy,
not proof of Google's consent configuration, native callback routing or Cloudflare
alarm execution.

## Sources

Consulted 2026-11-11:

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server):
  authorization code flow, redirect registration, offline access and revocation.
- [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list):
  inbox filtering and bounded page tokens.
- [Gmail messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get):
  metadata headers and message identity.
- Pinned Alchemy `2.0.0-beta.80` source, `Cloudflare/Workers/AlarmCallback.ts`:
  initialization registration, persistent callback IDs/versions, shared alarm
  reconciliation and retry behavior.
