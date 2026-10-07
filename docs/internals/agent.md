# Agent internals

How turns, tools, context, undo, budget, and curation work inside `UserSpace`.

## Detached turns

- Turns run **inside `UserSpace`**, detached from the WebSocket request that started them.
- `chat.send` starts (or attaches to) a turn and streams progress (`Started` → deltas / tools → `Changes` → `Done`).
- Backgrounding the app or dropping the socket must not cancel the turn. The final assistant message and events still land in the event log and arrive via `sync.subscribe`.
- `chat.stop` cancels the in-flight turn for that chat.

## Five tools

Defined in `@yatma/core` (`tools.ts`), implemented in the worker against DO SQLite + core rules:

| Tool | Purpose |
| --- | --- |
| `list_tasks` | Filter by project, status, quadrant, date; priority order. |
| `search` | FTS5 over tasks (incl. done + reasons), pages, chat summaries. |
| `read` | One task + history, a page, or a chat summary. |
| `apply_changes` | One batch of project/task ops; core rules validate all-or-nothing; one shared reason. |
| `write_page` | Create or replace a page or brief (with reason). |

Agents must supply reasons on writes. No-op updates write nothing.

## `buildContext`

Pure function in `@yatma/core`. The phone’s Context tab renders the same output the model sees.

**Global chat**

- Today’s date
- Me brief (`projectId: null`)
- Every project with the first line of its brief
- Top 30 open tasks
- Doing summary

**Project chat**

- That project’s brief
- Open tasks (up to 60), one compact line each
- Page index (title + one line); pinned pages included in full
- Summaries of the last three chats

**Conversation slice**

- Rolling chat summary + last 12 messages

**Token budget**

- Trim tasks and the page index first when over budget. Briefs and pinned full pages stay preferred.

## Apply first, undo later

- The agent applies changes immediately—no confirm dialogs.
- Each turn’s writes share one `batch` id.
- The UI shows a change card with **Undo**, which runs `planUndo(batchEvents, currentEntities)` and appends revert events carrying `undoes`.
- Undo restores only fields that still hold the batch’s written values; later user edits are reported as skips (`changed_since`), never overwritten.

## Usage cap

- Each turn records token (or equivalent) usage on the user.
- A **daily cap** per user returns a typed `BudgetExceeded` error from `chat.send`.
- The chat UI states plainly that the cap was reached; no silent failure.

## Curator (M4)

Triggers:

- User taps **Wrap up** (`chat.wrapUp`), or
- **30 minutes idle** alarm on the Durable Object

Work (one cheap model call):

- Update chat title and summary
- Refresh the brief and handbook pages as needed

Result:

- Posts a “Handbook updated” change card with Undo (same apply-first batch model)

Helpers for alarm scheduling and wrap-up intent live in `apps/worker/src/curator.ts` (pure planning functions; IO stays in the DO).

## OpenRouter model config

- Calls go through `effect/ai` with an OpenRouter provider layer.
- The model id is a **config value** (env / alchemy secret), not hardcoded—prefer a cheap, fast chat model suitable for tool calling.
- Same toolkit schemas are used in tests with a scripted `LanguageModel` layer; never sleep in worker tests.
