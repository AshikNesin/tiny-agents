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
- **Claude Code:** add the Claude plan account in Settings → Models, with a
  sandbox (`SANDBOX_HOST` or `pnpm sandbox:up`), then sign in once
  from Settings → Models → Claude plan. The app sets up the worker on the sandbox
  ([Claude subscription](../claude-subscription.md)).

With neither configured, the sidebar has no **Code** and bots have no
`code_*` tools. With both, the list shows every thread with a harness
label and a filter, and **New thread** offers a harness picker.

## What a developer can do

The layout follows Cursor's cloud agents and Claude Code on the web:

- a slim top bar with a way back to the app (the workspace owns the full
  column — no app sidebar here) and the ⌘K trigger;
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
- **Select** (the checklist button beside New thread) turns the list into
  checkboxes: pick threads (a click on a row picks it; a picked thread's
  subagents go along), or **Select all**, then **Archive** (or **Restore** in
  the archived view) moves them all, with one Undo.

**Review.** **Changes** (⌘⇧D) shows the uncommitted changes, or a recent
commit, of the thread's directory, each changed file as a card with its
diff. Select lines and press **Comment** to put `` `path:lines` `` in the
composer.

**Away.** A followed thread (started, opened or handed off here) sends a push
(Settings → Notifications → _Code updates_) when it finishes, fails or asks
for you while no tab shows it. That covers Shelley's `message_user` and
Claude Code's approval requests.

## Projects, pull requests and Auto-fix

Issue #297 (ADR 0021, ADR 0022, ADR 0023). Everything here sits above the
harness contract, so it works for every harness whose `cwd` is on the
sandbox. Owner-only: guests see none of it.

**Set up.** **Projects** in the Code header opens the dialog:

- **GitHub.** Either save a fine-grained token for the project's
  repositories (recommended: it is kept as an `app` vault item for the
  `github` sink; API calls go from this server, and only `git push` runs on
  the sandbox, with the token on that command's stdin), or sign `gh` in
  with `gh auth login` from the Terminal page (every process on the sandbox
  can then use that login). The dialog says which is active and whom it
  acts as.
- **New project:** `owner/name` or a GitHub URL. The app checks the sandbox
  has `git` (and `gh` without a token) and that the credential reaches the
  repository, then clones it to `~/tiny-agents-code/<owner>--<name>/checkout`.
- **Per project:** the default harness, a `check` script override, trusted
  review bots, archive the thread when its PR merges (on by default), and
  Auto-fix new PRs (off by default).

**Scripts** are read from a checked-in `.tiny-agents/code.json`:

```json
{ "setup": "pnpm install", "check": "pnpm test", "archive": "rm -rf node_modules" }
```

`setup` runs in a new worktree before the first turn and after unarchive (a
failure is reported to the agent; the turn still starts). The agent is told
to run `check` before it reports done. `archive` runs before a worktree is
removed.

**Start.** Pick the project on the New thread screen. The thread gets its
own worktree on a new branch `ta/<slug>-<hex>` from the freshly fetched base
branch, and its first message starts with one line naming the branch and
telling the agent to commit but not push.

**Review.** In a project thread, Changes (⌘⇧D) shows everything since the
merge base with the base branch, committed or not: a file list with a
filter (generated files and lockfiles muted and last), **Viewed** marks that
come back unmarked when the agent changes the file again, `[` / `]` between
files, and line comments kept as drafts until **Send to agent** posts them
as one message, each with its file, lines and quoted lines. **Uncommitted or
a commit** switches to the harness's own Changes.

**Publish.** The **PR** button in the thread header opens the PR tab.
**Publish draft PR** pushes the branch (never forced, hooks off) and opens a
draft PR with the commits as its body; with a PR open, Publish pushes new
commits. **Link pull request** links an existing one, and a PR the agent
opened for the branch is linked on its own. After a PR merges, the next
Publish opens a new one; earlier PRs are listed.

**The PR tab.** Checks at a glance (failures link to their log; a check
pending for 6 hours is **Stalled** and no longer blocks green), reviews,
unresolved comments (from authors Auto-fix does not trust, labelled
**Ignored**), **Attach all comments** into the composer, the description,
**Fix CI** (one pass now), **Merge** with the repository's methods, the
**Auto-fix** switch with its state, the pass history, and **Unlink**.
Opening the tab reconciles with GitHub.

**Auto-fix.** While on, the app watches the PR (every minute while checks
move, every 5 minutes idle) and starts a pass for a failed check, a trusted
review or comment, or a merge conflict, after a 60-second quiet period:

- The pass is sent to the thread (queued behind a running turn) with the
  log tails and comments inside a block marked untrusted, and fixed
  instructions: fix root causes, never weaken a test, do not edit CI
  workflow files, run `check`, commit, end with an `autofix-report` block.
- When the turn ends, the app pushes. It does not push a pass with no new
  commit, one that touches a protected path (`.github/workflows/**` by
  default), or one GitHub rejects; the loop then waits for you. It replies
  to each fixed thread with the commit and resolves it; without a report it
  posts one summary comment and resolves nothing.
- Trusted: you, the repository's owners, members and collaborators, and the
  review bots you list. The app's own comments never start a pass. PRs from
  forks are never fixed. Approvals never start a pass.
- Limits: 6 passes in an hour pauses until someone pushes, reviews or
  writes; 10 passes in a row without you switches Auto-fix off; a pass past
  20 minutes is stopped. Writing in the thread moves a waiting loop on.
- A pass runs in the thread's own permission mode, never with YOLO's trust:
  anything the harness asks waits for you.
- Pushes (Settings → Notifications): **Auto-fix needs you** (it stopped for
  you, switched itself off, or a check stalled) and **Pull request updates**
  (checks green, merged, or failed with Auto-fix off). None while the
  thread is on screen.

Not built yet: the native pi-durable harness (phases 0 and 1), the GitHub
App transport and webhooks, auto-merge, a final check when green, merge
queues, per-turn checkpoints, a per-thread spend limit, and the
`Thread-Id` commit trailer.

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
harness was unreachable is delivered when it reconnects. A finish is
recorded as owed before it is sent, so one cut off by a restart or a failed
send is sent again (at boot, on reconnect, and every 30 seconds) until it
lands; the chat takes it once. A replayed `code_start` makes one thread, and
a follow-up is armed to report back before the harness hears it. Claude Code
hand-offs start in Accept edits; anything else they ask (commands, questions)
waits for the owner on the Code page.

Known limits (register row C7):

- A start whose `createThread` call fails after the harness already made the
  thread (a client timeout, say) drops its claim, so a replay of that tool
  call can make a second thread. Harnesses take no idempotency key to prevent
  it.
- A finish that can never be delivered (its bot's chat keeps refusing the
  submit) is retried, and logged, every 30 seconds for as long as the app
  runs. Deleting the bot removes it.

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
  - `claude-code`: the worker's coding mode (`coding.*`) on its own Worker
    connection (`@tiny-agents/claude-worker/client`, shared with the bot
    engine: heartbeat, reconnect, resume, restart detection), SDK messages
    and session history normalized.
- **Thread feed:** `packages/code/src/server/feed.ts`. Drivers hand their
  `ThreadFeed` the whole thread (a snapshot, the full row list, the streaming
  text, state); the feed keeps the event order for every watcher, so no
  driver writes it again.
- **Turn outcome:** `packages/code/src/server/outcome.ts`. Both `outcome()`
  and the `turn_ended` event are `turnOutcome(thread, rows, endedAt)`, so a
  hand-off finish, `code_status` and a push read the same thing for every
  harness:
  - the text is the newest turn's last answer (consecutive text rows are
    one answer) or its error (`failed`), cut to a chat-sized excerpt;
  - a turn ends at a turn row or an error. A message after the newest turn
    end opened a new turn, so with nothing answered since the text is empty
    (never an earlier turn's answer). A steer went into the running turn, so
    that turn's answer before it still counts;
  - `endedAt` is when the harness last wrote to the turn, on its own record
    (Shelley's newest agent or error message, Claude Code's newest result),
    and is absent while the thread works.

  `turn_ended` fires once the harness is idle (a steer Claude Code runs as
  its own SDK turn is part of the turn it went into) and carries the outcome;
  the watcher only reads it. Thread ids are split only by `parseThreadId`
  (bare ids from before ADR 0011 belong to `shelley`).

- **App:** `apps/web/src/server/api/code/`:
  - `code.registry.ts`: which harnesses run, from env.
  - `code.hub.ts`: starts every instance, caches the decorated lists, counts
    viewers.
  - `code.watcher.ts`: delivers hand-off finishes and sends pushes.
  - `code.routes.ts`: `/api/v1/code/*`.
  - `code.bots.ts`: the bots' `CodeStore`.
  - `code.store.ts`: the tables.
  - `code.projects.ts`, `code.workspace.ts`: projects, and git on the
    sandbox (worktrees, base-branch diffs, the push rules).
  - `code.github.ts`: the GitHub client and git credential, from Settings.
  - `code.pulls.ts`, `code.pulls.store.ts`: PR links, Publish, the
    reconcile chain (`code-pr-reconcile`) and the PR tab.
  - `code.autofix.ts` (the pure `decide`), `code.passes.ts` (a pass).
  - `code.projects.routes.ts`: `/api/v1/code/{projects,github}` and a
    thread's `pr`, `publish` and `review` routes.
- **Tables:**
  - `code_threads`: the index. Followed threads and how far you have read
    them, plus the rows of harnesses without their own list.
  - `code_handoffs`: the hand-offs, `starting → running → finished`
    compare-and-set.
  - `code_handoff_finishes`: finishes owed to bots' chats, until delivered.
  - `code_projects`; `code_pull_requests` (a cache of GitHub plus the
    Auto-fix loop); `code_autofix_passes`; `code_pr_comments` (the app's own
    comments); `code_review_viewed` and `code_review_drafts`.
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
3. Make the tests pass: `capabilityProblems(instance)`,
   `threadEventProblems(events)` (on what a watcher received) and
   `turnOutcomeProblems(snapshot, outcome, ended)` must be empty, the shared
   turn-outcome cases (`tests/server/code/turn-outcome-conformance.ts`) must
   pass on the driver's fake, plus the shared scenarios (a simple turn, multi-turn, queued turn,
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
