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
`code_*` tools. With both, each thread in the list names its harness, and
**New thread** offers a harness picker.

## What a developer can do

The layout follows [t3code](https://github.com/pingdotgg/t3code) (see
[CREDITS](../../CREDITS.md)): minimal, with threads grouped by project.

- a sidebar with the way back to the app, the ⌘K trigger, search, and the
  threads grouped by project (the workspace owns the full column; no app
  sidebar here), with **Archived** and **Settings** at its foot;
- one line per thread in the list;
- a one-line header: the title (its menu holds the actions and the cost),
  the project or folder, PR and Changes;
- every setting a turn needs (model, reasoning, permissions, context) as a
  chip inside the composer.

**A control appears only when the thread's harness has its capability.**
Shelley has no approvals, so its threads show no permission chip. Claude Code
has no background jobs, so its threads show no job chips.

**Find.**

- Threads are grouped by project, then by repository or folder for threads
  outside a project; the most recently active group comes first, and a
  project with no thread yet comes last. A group folds away (remembered),
  shows its newest 8 threads with **Show more**, and offers **New thread**
  in it (and, for a project, its settings) on hover. Inside a group,
  working threads come first, with subagents nested under their parent.
- **Archived** at the foot of the sidebar lists archived threads, grouped
  the same way, with **Restore**.
- Search: full-text where the harness searches; a title filter otherwise.
  Several harnesses: each row names its harness.
- Unread dots for turns that ended since you last looked, and ⌘K to jump to
  any thread.
- `/code/s/<title>` opens a thread by title. Links from before the harness
  layer (`/code/<shelley id>`) still open.

**Start.** `/code` (`/code/new` on phones), or a group's **New thread**
(`/code/new?project=<id>` or `?cwd=<path>`, which picks that project or
folder):

- Pick a project, or the working directory (recent ones, a typed path, a
  folder browser, checked by the harness) and, where the harness makes
  them, a new worktree; and the harness (remembered) when there are several.
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

**Review.** **Changes** (⌘⇧D) shows the uncommitted changes (new files
included), or a recent commit, of the thread's directory, each changed file
as a card with its diff. Unchanged runs fold into **Show N more lines**, one
gutter numbers the lines, and long lines wrap.

- **Comments.** Hover a line and press its **+** to open a composer right
  under it (shift-click another line's **+** to widen the range); ⌘↵ saves.
  The comment stays under its line and waits above the thread's composer
  ("N comments go with your next message"), where each can be removed. The
  next message you send takes them along in the same turn, ahead of your
  words; **Send now** sends them on their own. The agent gets each with its
  file, lines and the quoted lines; the thread shows them as comment cards.
  Comments are kept per thread on the server, so they survive a reload, and
  work for every harness. A guest's comment, which cannot be saved, goes into
  the composer as `` `path:lines` `` and its text.
- **Review page.** Each side pane's **Open as a page** opens the thread's
  Review page (`/code/<id>/review`): **Changes** and, for a project thread,
  **Pull request** (`?tab=pr`), each a tab at full width. Comments work there
  as in the pane and wait in a tray at the bottom (**Send now**); **Back to
  the thread** returns to the composer, where they go with the next message.
- **Hide sidebar** (top of the thread list) or ⌘B folds the list away on
  wide screens so the thread and Changes get the room; **Show sidebar** at
  the top left brings it back. The choice is remembered in this browser.
- The thread's header reads `folder / title` (the project's name for a
  project thread), and each row in the list shows its pull request (`#12`,
  toned when it needs you, is fixing, passes or merged).

- While it is open it stays live: the server watches the directory and the
  panel re-reads when the files move, in place (the list, what you folded
  and the scroll stay). This works for every harness that serves diffs: the
  app reads a cheap change stamp where it can (project worktrees, Claude
  Code) and otherwise the harness's own file list (Shelley).
- A binary file, or one over 2 MB, says so instead of showing its bytes,
  whichever harness served it. A very long diff draws its first 4,000 lines.

**Away.** A followed thread (started, opened or handed off here) sends a push
(Settings → Notifications → _Code updates_) when it finishes, fails or asks
for you while no tab shows it. That covers Shelley's `message_user` and
Claude Code's approval requests.

## Projects, pull requests and Auto-fix

Issue #297 (ADR 0021, ADR 0022, ADR 0023). Everything here sits above the
harness contract, so it works for every harness whose `cwd` is on the
sandbox. Owner-only: guests see none of it.

**Set up.** Projects are settings pages of their own, under **Settings**
at the foot of the Code sidebar (`/code/settings`):

- **GitHub** (`/code/settings/github`). Either save a fine-grained token
  for the project's repositories (recommended: it is kept as an `app` vault
  item for the `github` sink; API calls go from this server, and only
  `git push` runs on the sandbox, with the token on that command's stdin),
  or sign `gh` in with `gh auth login` from the Terminal page (every process
  on the sandbox can then use that login). The page says which is active and
  whom it acts as, and sets up the optional GitHub App (below).
- **Projects** (`/code/settings/projects`). **Add a project:** `owner/name`
  or a GitHub URL, or, with the GitHub App, a searchable list of the
  repositories it is installed on. The app checks the sandbox has `git`
  (and `gh` without a token) and that the credential reaches the
  repository, then clones it to
  `~/tiny-agents-code/<owner>--<name>/checkout` and opens its page.
- **A project's page** (`/code/settings/projects/<id>`, or the gear on its
  sidebar group): its name, base branch, default agent and model; the
  `setup`, `check` and `archive` script overrides; archive the thread when
  its PR merges (on by default) and auto-merge new PRs; Auto-fix new PRs
  (off by default), each Auto-fix trigger (failed checks, review comments,
  merge conflicts, removed from the merge queue), the final check, trusted
  review bots and protected paths; the Auto-fix limits; and **Remove**.

**Scripts** are read from a checked-in `.tiny-agents/code.json`:

```json
{ "setup": "pnpm install", "check": "pnpm test", "archive": "rm -rf node_modules" }
```

`setup` runs in a new worktree before the first turn and after unarchive (a
failure is reported to the agent; the turn still starts). The agent is told
to run `check` before it reports done. `archive` runs before a worktree is
removed.

**Start.** Pick the project on the New thread screen. The thread gets its
own worktree on a new branch from the freshly fetched base branch, and its
first message starts with one line naming the branch and telling the agent
to commit but not push.

The branch is named for what the task does, short: `ta/fix-google-callback`,
not the prompt's opening words. One side-call on the `chat_title` model role
(Settings → Models) reads the task and names it (2 to 4 words, starting with
a verb), with an 8-second limit. With no model, a failed call or an unusable
answer, the name is the task's first words without the filler ("Can you
please fix the login flow when…" is `ta/fix-login-flow-users`). A name an
earlier thread took, here or on the remote, gets `-2`, `-3`, ….

**Review.** In a project thread, Changes (⌘⇧D) shows everything since the
merge base with the base branch, committed or not (new files included), live
as above: a file list with a
filter (generated files and lockfiles muted and last), **Viewed** marks that
come back unmarked when the agent changes the file again, `[` / `]` between
files (or the file bar over the diff: previous, next, `n of N`, **Viewed**;
**Hide file list** gives the diff the panel's full width), and line comments
as above. **Uncommitted or a commit** switches to the harness's own Changes.

**Publish.** The **PR** button in the thread header opens the PR tab.
**Publish draft PR** pushes the branch (never forced, hooks off) and opens a
draft PR with the commits as its body; with a PR open, Publish pushes new
commits. **Link pull request** links an existing one, and a PR the agent
opened for the branch is linked on its own. After a PR merges, the next
Publish opens a new one; earlier PRs are listed.

**The PR tab.** Checks at a glance (failures link to their log; a check
pending for 6 hours is **Stalled** and no longer blocks green), reviews,
unresolved comments (from authors Auto-fix does not trust, labelled
**Ignored**), **Attach all comments** into the composer, the description
(rendered as markdown, template comments hidden; **Edit** saves it to GitHub
while the PR is open),
**Fix CI** (one pass now), **Merge** with the repository's methods, the
**Auto-fix** switch with its state, the pass history, and **Unlink**.
Opening the tab reconciles with GitHub, and while it is on screen it
re-reads (and so reconciles) every 15 seconds, so a project on `gh` or a
token, with no webhooks, shows a finished check within seconds. A hidden
page stops reading and catches up when shown again; in the background the
server's own poll (below) carries on.
The actions sit in one row; the switches are plain rows, and the spend
limit shows only where the harness reports cost.

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

**Each thread's commits** carry `Thread-Id: <thread id>`, so `git log`
leads back to the conversation. The worktree's own hooks directory adds it,
then runs the repository's hooks as usual.

**Turns and revert.** Every turn that changed something is checkpointed:
the worktree, uncommitted files included, under a hidden ref in the
project's clone. In Changes, the scope picker shows what any one turn
changed, and **Revert to here** puts the files back as they were after that
turn, as uncommitted changes (commits, and anything pushed, stay; the state
it replaces is checkpointed first). Not while the agent works.

**More in the PR tab:**

- **Auto-merge** (off by default, or on for new PRs per project): with no
  pass running, the app turns on GitHub's auto-merge, marking a draft ready
  first; GitHub's branch protection decides when it merges. Switching it off
  turns GitHub's off too.
- **Spend limit:** where the harness reports cost, the thread's spend and a
  limit; at the limit Auto-fix pauses instead of starting a pass. Each pass
  shows what it cost.
- **Final check when green** (per project, off by default): one more pass
  that reviews the whole change when checks go green. If it changes nothing
  the PR settles green.
- **Merge queue:** a PR the merge queue removed gets a pass (per project,
  on by default); a queued PR shows **queued**.

**GitHub App (optional).** Settings → GitHub → **Create GitHub App**
(optionally under an organization). GitHub's App Manifest flow does the
rest, as FeedbackBee's setup does: GitHub opens with the App already
described (contents and pull requests read and write, checks, statuses and
Actions read, and the pull request, review, check, status and issue comment
events), you confirm, and GitHub returns to Code's GitHub settings with the App's id, private
key and webhook secret, which are kept as `app` vault items. **Install on
repositories** then picks the repositories; a new project with **GitHub
App** on lists them. Projects on the App use short-lived installation tokens
for API calls and pushes. When `ORIGIN` is a public https address, GitHub's
webhooks bring each reconcile forward to within seconds (deliveries must be
signed, and a redelivery is ignored); otherwise the App is made without a
webhook and Code polls. The setup's two redirects are bound to the browser
that started it (a 10-minute, single-use state plus an httpOnly cookie).
**Disconnect** forgets the App; delete it on GitHub yourself.

Not built yet: the native pi-durable harness (phases 0 and 1), re-running a
flaky check before spending a pass, mention commands from PR comments,
threads started from issues, a preview script, and matching Shelley threads
to projects by remote.

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
  - `code.checkpoints.ts`: per-turn checkpoints and revert.
  - `code.changes.ts`: live Changes and Review panels (ADR 0025): while one
    is open, one poll per directory reads its change stamp and
    `GET /code/threads/:id/changes` pushes a version when it moves.
  - `code.webhook.ts`: the GitHub App's signed webhook (public).
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
    comments); `code_review_viewed` and `code_review_drafts`;
    `code_checkpoints`; `code_pr_events` (webhook deliveries, by id).
  - The old `shelley_seen` and `shelley_handoffs` rows are copied in at
    boot.
- **Client:**
  - `lib/code/`: API, live thread hook, list tree, tool folding.
  - `store/code.ts`: the app-wide list stream.
  - `pages/code/`: the page; `CodeSettings.tsx` is `/code/settings`.

- **Git reads:** `@tiny-agents/git` (`packages/git`), one module for both
  panels and every harness (ADR 0025): the project workspace runs it over
  SSH whatever agent works there, the Claude worker runs it next to the
  files, and `guardSides` holds every harness's diffs to its rules. Plumbing commands only, so a read never
  rewrites the index an agent commits through; `-z` paths; untracked files
  count as added; a binary or oversized side is `unshowable`.

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
