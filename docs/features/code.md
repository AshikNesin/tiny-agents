# Code

`/code` is one workspace for the owner's coding agents. Each agent is a
**harness** (issue #143, issue #157): tiny-agents drives it but runs no
coding loop of its own. Every harness plugs in through one adapter contract,
and the page, the bots and the notifications only ever see that contract.
Why: [ADR 0009](../adr/0009-shelley-is-the-coding-agent.md),
[ADR 0011](../adr/0011-code-harness-adapters.md),
[ADR 0012](../adr/0012-claude-code-coding-mode.md).

| Harness         | Instance id   | Runs on                       | Reached through                                         | Owns the transcript                        |
| --------------- | ------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| **Shelley**     | `shelley`     | the owner's Shelley server    | Shelley's official HTTP/SSE API (`SHELLEY_URL`)         | Shelley's database                         |
| **Claude Code** | `claude-code` | the sandbox (VM or container) | the Claude worker's coding mode, through its SSH tunnel | Claude Code's session files on the sandbox |

## Setup

- **Shelley:** set `SHELLEY_URL` to its address on your tailnet (e.g.
  `http://100.100.200.200:9999`) and restart.
  - Shelley has no auth of its own, so never expose it publicly.
  - Every request sends `X-Exedev-Userid`: exe.dev's `-require-header`
    guard needs it when you reach Shelley directly over Tailscale.
  - "Open in Shelley" links to the same address.
- **Claude Code:** turn on the Claude plan: `CLAUDE_CODE_ENGINE_ENABLED=1`
  with a sandbox (`SANDBOX_HOST` or `pnpm sandbox:up`), then sign in once
  from Settings → Claude plan. The app sets up the worker on the sandbox
  ([Claude subscription](../claude-subscription.md)).

With neither configured, the sidebar has no **Code** and bots have no
`code_*` tools. With both, the list shows every thread with a harness
label and a filter, and **New thread** offers a harness picker.

## What a developer can do

The layout follows Cursor's cloud agents and Claude Code on the web:

- one line per thread in the list;
- a one-line header;
- every setting a turn needs (model, reasoning, permissions, context) as a
  chip inside the composer.

**A control appears only when the thread's harness has its capability.**
Shelley has no approvals, so its threads show no permission chip. Claude Code
has no background jobs, so its threads show no job chips.

**Find.**

- _Working now_ on top, then _Recent_, with subagents nested under their
  parent and an _Archived_ toggle.
- Filters: harness and repository. Full-text search where the harness
  searches; a title filter otherwise.
- Unread dots for turns that ended since you last looked, and ⌘K to jump to
  any thread.
- `/code/s/<title>` opens a thread by title. Links from before the harness
  layer (`/code/<shelley id>`) still open.

**Start.** `/code` (`/code/new` on phones):

- Pick the harness (remembered), the working directory (recent ones, a typed
  path, a folder browser, checked by the harness) and, where the harness
  makes them, a new worktree.
- The model, reasoning and permission chips sit in the composer. Claude Code
  needs a working directory and starts in **Accept edits**.
- If another thread is working in the same directory, a warning says both
  threads will edit the same files.

**Write.**

- Enter sends. While the agent works, Enter **steers** (the message goes into
  the running turn) and the queue button (or Alt+Enter) holds it for when the
  turn ends. With an empty draft, the send button is **Stop** (⌘.).
- Queued messages can be sent now or cancelled.
- `@` completes files and folders in the working directory, and `/` hints the
  harness's commands.
- **+** attaches files (or paste or drop them) and picks skills. Drafts are
  kept per thread.

**Watch.**

- Streaming text and thinking, and every tool call as a row. A run of
  finished calls folds into one line ("Ran 3 commands, edited 2 files ·
  1 failed").
- Per tool:
  - bash: its command, live output and exit code;
  - edits: the diff, with +/−;
  - subagents: a live status and **Open**;
  - plans: a checklist (Claude Code's TodoWrite);
  - screenshots: shown inline.
- **Approval and question cards:** Allow / Deny, or pick answers. They show
  only for a harness that asks.
- Errors come with **Retry** or **Try another model** where the harness
  offers them; usage limits say when they reset.
- A turn ends with "Worked for 12s · $0.04".
- The context ring opens the usage report: per-model token bands and cost,
  indirect usage, subagents, and **Compact in place**.

**Control.**

- Stop, Resume, rename, change directory, fork from a message, delete,
  Open in Shelley — each where the harness has it.
- **Archive** moves a thread **with its subagents**, with Undo.

**Review.** **Changes** (⌘⇧D) shows the uncommitted changes, or a recent
commit, of the thread's directory, each changed file as a card with its
diff. Select lines and press **Comment** to put `` `path:lines` `` in the
composer.

**Away.** A followed thread (started, opened or handed off here) sends a push
(Settings → Notifications → _Code updates_) when it finishes, fails or asks
for you while no tab shows it. That covers Shelley's `message_user` and
Claude Code's approval requests.

## Bots hand off coding

Every bot has the `code` toolkit. Shelley is the default harness; a bot names
another with `harness` (the bot's prompt lists the configured ones).

| Tool            | Permission | What it does                                                       |
| --------------- | ---------- | ------------------------------------------------------------------ |
| `code_start`    | allow      | Start a thread (`harness`, `task`, `cwd`, `model`); returns a link |
| `code_send`     | allow      | Steer or follow up any thread by id (adopts one started elsewhere) |
| `code_status`   | allow      | Working or idle, the last answer, and uncommitted changed files    |
| `code_list`     | allow      | This bot's hand-offs                                               |
| `code_models`   | allow      | A harness's ready models, its default first                        |
| `shelley_start` | allow      | Alias of `code_start` with `harness: shelley` (older prompts)      |
| `shelley_send`  | allow      | Alias of `code_send` for Shelley ids                               |

The chat shows a hand-off as a card with the live state and **Open in Code**.
When the turn ends, the outcome arrives in the bot's chat once as "Reply from
<harness>" (untrusted peer text); nothing polls. A finish missed while a
harness was unreachable is delivered when it reconnects. Claude Code
hand-offs start in Accept edits; anything else they ask (commands, questions)
waits for the owner on the Code page.

## How it works

- **Contract:** `packages/code/src/contracts`:
  - `HarnessInstance`, the adapter;
  - `TranscriptItem`, the rows;
  - `ThreadEvent` and `InstanceEvent`, the live events;
  - `Capabilities`;
  - `HarnessHost`, what the app gives drivers.
- **Drivers:** `packages/code/src/drivers/<kind>/`:
  - `shelley`: one `stream2` connection, the snapshot list, Shelley's wire
    format normalized, and the usage maths.
  - `claude-code`: the worker's coding mode over WebSocket, SDK messages and
    session history normalized.
- **Thread feed:** `packages/code/src/server/feed.ts`. Drivers hand their
  `ThreadFeed` the whole thread (a snapshot, the full row list, the streaming
  text, state); the feed keeps the event order for every watcher, so no
  driver writes it again.
- **App:** `apps/web/src/server/api/code/`:
  - `code.registry.ts`: which harnesses run, from env.
  - `code.hub.ts`: starts every instance, caches the decorated lists, counts
    viewers.
  - `code.watcher.ts`: delivers hand-off finishes and sends pushes.
  - `code.routes.ts`: `/api/v1/code/*`.
  - `code.bots.ts`: the bots' `CodeStore`.
  - `code.store.ts`: the tables.
- **Tables:**
  - `code_threads`: the index. Followed threads and how far you have read
    them, plus the rows of harnesses without their own list.
  - `code_handoffs`: the hand-offs, `running → finished` compare-and-set.
  - The old `shelley_seen` and `shelley_handoffs` rows are copied in at
    boot.
- **Client:**
  - `lib/code/`: API, live thread hook, list tree, tool folding.
  - `store/code.ts`: the app-wide list stream.
  - `pages/code/`: the page.

A thread's stream (`GET /code/threads/:id/events`) starts with a snapshot.
After that it upserts rows by id and sends partial text and state, so a
reload or reconnect never loses or duplicates a row. When a driver may have
missed events (Shelley's stream reconnects, the Claude worker restarts or
skips ahead), its watchers start over from a fresh snapshot, followed by the
streaming text if a turn is still running.

## Adding a harness

1. Add a driver folder `packages/code/src/drivers/<kind>/`:
   - a factory returning a `HarnessInstance`;
   - a normalizer to `TranscriptItem`s;
   - a `ThreadFeed` per watched thread for `watchThread`, fed the full row
     list and state (not diffs);
   - honest capabilities.
2. Add one entry in `code.registry.ts`, with its config.
3. Make the tests pass: `capabilityProblems(instance)` and
   `threadEventProblems(events)` (on what a watcher received) must be empty,
   plus the shared scenarios (a simple turn, multi-turn, queued turn,
   interrupt, stop before start, steer, approvals, resume after reconnect).
4. Add a row to the table above and a short section here.

## Testing

- **Shelley:** server tests run against a fake Shelley speaking the real wire
  format (`tests/server/code/shelley/`), and normalizer tests use payloads
  captured from a real Shelley (`tests/fixtures/shelley/`).
- **App layer:** tested against an in-memory harness
  (`tests/server/code/fake-harness.ts`) to show it never depends on a
  particular harness.
- **Claude Code:** driven through the worker with a fake SDK. CI never
  calls Anthropic.
- **Shelley by hand:** run Shelley with its keyless test model:

```bash
shelley -predictable-only -db /tmp/shelley.db serve -port 9000
```

Then send `bash: ls`, `subagent: lint bash: echo ok`, `patch success`,
`delay: 10` (steer or queue while it runs) or `tool smorgasbord`.
