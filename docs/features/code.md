# Code (Shelley)

`/code` is a first-class workspace for [Shelley](https://github.com/boldsoftware/shelley),
the coding agent the owner runs on another machine (issue #143). tiny-agents
runs no coding loop: every view is Shelley's official HTTP/SSE API, read live
through a curated proxy, so Shelley stays on the tailnet behind the app's
login. Why: [ADR 0009](../adr/0009-shelley-is-the-coding-agent.md).

## Setup

1. Run Shelley where the app host can reach it (e.g. `shelley serve -port 9000`
   on a VM on your tailnet). Shelley has no auth of its own; never expose it
   publicly.
2. Set `SHELLEY_URL=http://<vm>:9000` and restart. The sidebar gains **Code**.
3. Optional: `SHELLEY_TOKEN` (a bearer for an authenticating proxy in front of
   Shelley) and `SHELLEY_PUBLIC_URL` (the URL your browser uses, for
   "Open in Shelley").

Without `SHELLEY_URL` nothing changes: no nav entry, no stream, no bot tools.

## What a developer can do

**Find.** Every conversation: _Working now_ on top, then _Recent_, with
**subagents nested under their parent** (live), an _Archived_ toggle, a
repository filter, full-text search, unread dots for turns that ended since you
last looked, and ⌘K to jump to any conversation. `/code/s/<slug>` opens a
conversation by slug.

**Start.** A task, a working directory (recent ones, a folder browser, checked
by Shelley), optionally a **new git worktree** for parallel work on one repo,
and the model and reasoning level.

**Write.** Enter sends. While Shelley works, Enter **steers** (the message goes
into the running turn) and **Queue** (or Alt+Enter) holds it for when the turn
ends; queued messages can be sent now or cancelled. `@` completes files and
folders in the working directory; `/` hints Shelley's commands (`/model`,
`/compact`, `/btw`, `/fork`, `/cwd`, `/new`, `/help`); paste or drop files to
attach them; pick skills for a message. Drafts are kept per conversation.

**Watch.** Streaming text, thinking, and one row per tool: `bash` with its
command, **live output** while it runs and exit code; `patch` with its diff and
+/−; `subagent` with a live status and **Open**; screenshots inline; subagent
reports, background-job exits, errors (with **Retry** / **Try another model**),
and turn dividers with duration and cost. The header shows the subagent path,
cwd and commit, a **model and reasoning switch**, a **context meter** (click to
compact) and the conversation's cost, subagents included. A running strip shows
the turn, background jobs (kill) and running subagents (stop).

**Control.** Stop (⌘.), Resume after a restart, rename, change directory, fork
from any message, archive, delete, Open in Shelley.

**Review.** **Changes** (⌘⇧D) shows the working tree and recent commits of the
conversation's directory, their files with +/−, and each file's diff. Click a
line number (shift-click to extend) and **Comment** to put `` `path:lines` `` in
the composer — review feedback goes straight back to Shelley.

**Away.** A followed conversation (started, opened or handed off here) pushes a
notification (Settings → Notifications → _Shelley updates_) when it finishes,
fails or messages you while no tab shows it.

## Bots hand off coding

Every bot has the `shelley` toolkit (no tools without `SHELLEY_URL`):

| Tool             | Permission | What it does                                                    |
| ---------------- | ---------- | --------------------------------------------------------------- |
| `shelley_start`  | ask        | Start a Shelley conversation; returns at once with a link       |
| `shelley_send`   | ask        | Steer or queue a follow-up on one of this bot's hand-offs       |
| `shelley_status` | allow      | Working or idle, the last answer, and uncommitted changed files |
| `shelley_list`   | allow      | This bot's hand-offs                                            |

The chat shows a `shelley_start` call as a card with the live state and
**Open in Code**. When Shelley's turn ends, the outcome arrives in the bot's
chat once as "Reply from Shelley" (untrusted peer text) — nothing polls. A
finish missed while the stream was down is delivered when it reconnects.

## How it works

- `apps/web/src/server/api/shelley/shelley.hub.ts` — the single
  `/api/stream2` connection: reconnects with backoff, re-reads
  `/api/conversations/snapshot` (debounced) on list patches, fans frames out
  per conversation, reports turn ends (`working` true → false, with
  `agent_done`'s `final_response`).
- `shelley.routes.ts` — the allowlist under `/api/v1/shelley`, and
  `GET /shelley/events` (SSE: `status`, `list`, and one conversation's `frame`s
  with `?conversation=<id>&list=0`).
- `shelley.watcher.ts` — hand-off finishes (via `submitToBot`) and pushes.
- `shelley.store.ts` / `packages/agent/src/toolkits/shelley.ts` — the bot tools.
- Tables: `shelley_handoffs` (bot → Shelley conversation, `running →
  finished` compare-and-set) and `shelley_seen` (followed conversations and the
  last seen `sequence_id`).
- Client: `lib/shelley/` (API, transcript fold, list tree, live conversation
  hook), `store/shelley.ts` (the app-wide list stream), `pages/code/`.

Shelley's wire format, for reference: content block `Type` is a number (2
text, 3 thinking, 5 tool use, 6 tool result); tool results and harness
messages (subagent reports, background-job exits, told apart by `user_data`)
arrive as `user` messages; tool display data (`patch` diffs, `subagent`
links) is in `display_data`.

## Testing

Server tests run against a fake Shelley speaking the real wire format
(`tests/server/api/shelley/fake-shelley.ts`); client tests fold payloads
captured from a real Shelley (`tests/fixtures/shelley/`). To try it by hand,
run Shelley with its keyless test model:

```bash
shelley -predictable-only -db /tmp/shelley.db serve -port 9000
```

and send `bash: ls`, `subagent: lint bash: echo ok`, `patch success`,
`delay: 10` (then steer or queue while it runs) or `tool smorgasbord`.
