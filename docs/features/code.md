# Code (Shelley)

`/code` is a first-class workspace for [Shelley](https://github.com/boldsoftware/shelley),
the coding agent the owner runs on another machine (issue #143). tiny-agents
runs no coding loop: every view is Shelley's official HTTP/SSE API, read live
through a curated proxy, so Shelley stays on the tailnet behind the app's
login. Why: [ADR 0009](../adr/0009-shelley-is-the-coding-agent.md).

## Setup

Set `SHELLEY_URL` to Shelley's address on your tailnet (e.g.
`SHELLEY_URL=http://100.100.200.200:9999`) and restart. That is the only
setting; the sidebar gains **Code**. Shelley has no auth of its own, so never
expose it publicly.

Defaults, no configuration:

- Every request sends `X-Exedev-Userid`. exe.dev runs Shelley with
  `-require-header X-Exedev-Userid` (its proxy normally adds it), and reached
  directly over Tailscale it answers 403 without it; any non-empty value passes.
- "Open in Shelley" links to `SHELLEY_URL` (reachable from your tailnet).
- The bot tools `shelley_start` and `shelley_send` are allowed by default (no
  approval card): handing coding work to Shelley is what the owner asked the
  bot for. Set them to Ask or Off per bot in its Tools tab.

Without `SHELLEY_URL` nothing changes: no nav entry, no stream, no bot tools.

## What a developer can do

The layout follows Cursor's cloud agents and Claude Code on the web: one
line per conversation in the list, a one-line header, and every setting a
turn needs (model, reasoning, context) as a chip inside the composer. Pickers
are searchable (`components/ui/search-select.tsx`: type to filter, ↑ ↓ ↵).

**Find.** Every conversation, one line each: _Working now_ on top, then
_Recent_, with **subagents nested under their parent** (live), an _Archived_
toggle, a searchable repository filter, full-text search, unread dots for
turns that ended since you last looked, and ⌘K to jump to any conversation.
`/code/s/<slug>` opens a conversation by slug.

**Start.** `/code` (`/code/new` on phones): above the composer, the working
directory (searchable: recent ones, a typed path, a folder browser, checked by
Shelley) and an optional **new worktree** for parallel work on one repo; in
it, the model and reasoning chips. The latest tasks are listed below.

**Write.** Enter sends (on touch screens the button sends; Enter is a newline).
While Shelley works, Enter **steers** (the message goes into the running turn),
the queue button (or Alt+Enter) holds it for when the turn ends, and with an
empty draft the send button is **Stop**; queued messages can be sent now or
cancelled. `@` completes files and folders in the working directory; `/` hints
Shelley's commands (`/model`, `/compact`, `/btw`, `/fork`, `/cwd`, `/new`,
`/help`); **+** attaches files (or paste / drop them) and picks skills for a
message. Drafts are kept per conversation.

**Watch.** Streaming text, thinking, and tool calls: a run of finished calls
folds into one line ("Ran 3 commands, edited 2 files · 1 failed") that opens to
each call; `bash` with its command, **live output** while it runs and exit
code; `patch` with its diff and +/−; `subagent` with a live status and
**Open**; screenshots inline; subagent reports, background-job exits, errors
(with **Retry** / **Try another model**), and "Worked for 12s · $0.04" when a
turn ends. The header shows the subagent path, the title (its menu holds the
conversation's actions), cwd and commit, and the conversation's cost,
subagents included. The composer's chips switch the **model** and
**reasoning** (next turn) and show a **context ring**: clicking it opens the
usage popup (a port of Shelley's own), with the context total, per-model
token bands (cache read/write, input, output) at their models.dev rates and
estimated cost, "other" indirect usage (compaction, slug generation, …), a
sub-agent column when children exist, and **Compact in place** (which sends
`/compact`). Pricing comes through the curated proxy
(`POST /shelley/model-costs`).
Running background jobs (kill) and subagents (stop) sit above the composer.

**Control.** Stop (⌘.), Resume after a restart, rename, change directory, fork
from any message, delete, Open in Shelley. **Archive** (hover a row, or the
header) moves the conversation **with its subagents** — Shelley archives one
conversation at a time, so the proxy cascades to every descendant — and the
toast offers Undo; Restore in the archived view brings them back together.

**Review.** **Changes** (⌘⇧D) shows uncommitted changes or a recent commit of
the conversation's directory (searchable), every changed file as a card with
its +/− and diff in one scroll (generated files folded). Click a line number
(shift-click to extend) and **Comment** to put `` `path:lines` `` in the
composer — review feedback goes straight back to Shelley. Below 2xl the list
steps aside while Changes is open.

**Away.** A followed conversation (started, opened or handed off here) pushes a
notification (Settings → Notifications → _Shelley updates_) when it finishes,
fails or messages you while no tab shows it.

## Bots hand off coding

Every bot has the `shelley` toolkit (no tools without `SHELLEY_URL`):

| Tool             | Permission | What it does                                                             |
| ---------------- | ---------- | ------------------------------------------------------------------------ |
| `shelley_start`  | allow      | Start a Shelley conversation; returns at once with a link                |
| `shelley_send`   | allow      | Steer or follow up any conversation by id (adopts one started elsewhere) |
| `shelley_status` | allow      | Working or idle, the last answer, and uncommitted changed files          |
| `shelley_list`   | allow      | This bot's hand-offs                                                     |
| `shelley_models` | allow      | Shelley's ready models (custom ones included), its default first         |

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
