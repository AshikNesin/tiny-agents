# Code

`/code` is one workspace for coding in the cloud with the owner's coding
agents. It is built for four jobs: code with an agent in a thread, review
pull requests, steer a running agent, and run workflows that report back.
Each agent is a **harness**: tiny-agents drives it through one adapter
contract, and the page, the bots and the notifications only see that
contract. Code is for the owner only.

Why it is shaped this way:
[ADR 0011](../adr/0011-code-harness-adapters.md) (harness adapters),
[ADR 0020](../adr/0020-native-code-harness.md) (the native harness),
[ADR 0021](../adr/0021-code-projects-and-worktrees.md) (projects and
worktrees), [ADR 0023](../adr/0023-auto-fix.md) (Auto-fix) and
[ADR 0039](../adr/0039-code-threads-and-runs.md) (threads, runs, status and
rewind).

| Harness         | Instance id   | Runs on                                | Reached through                                         | Owns the transcript                        | Edit and retry a turn |
| --------------- | ------------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------------ | --------------------- |
| **Shelley**     | `shelley`     | the owner's Shelley server             | Shelley's official HTTP/SSE API (`SHELLEY_URL`)         | Shelley's database                         | no                    |
| **Claude Code** | `claude-code` | the sandbox (VM or container)          | the Claude worker's coding mode, through its SSH tunnel | Claude Code's session files on the sandbox | no                    |
| **Native**      | `pi`          | the app, with its tools on the sandbox | the bots' agent runtime, in process                     | the agent store                            | yes                   |

A control appears only when the thread's harness has its capability
(`Capabilities` in `packages/code/src/contracts`). Shelley has no
approvals, so its threads show no permission chip.

## Setup

- **Shelley:** set `SHELLEY_URL` to its address on your tailnet (e.g.
  `http://100.100.200.200:9999`) and restart.
  - Shelley has no auth of its own, so never expose it publicly.
  - Every request sends `X-Exedev-Userid`: exe.dev's `-require-header`
    guard needs it when you reach Shelley directly over Tailscale.
  - Every conversation tiny-agents starts or forks is tagged `tiny-agents`,
    and Code shows only those and their subagents. Conversations started in
    Shelley's own UI stay there.
- **Claude Code:** add the Claude plan account in Settings → Models, with a
  sandbox (`SANDBOX_HOST` or `pnpm sandbox:up`), then sign in once from
  Settings → Models → Claude plan. The app sets up the worker on the sandbox
  ([Claude subscription](../claude-subscription.md)).
- **Native:** a sandbox (`SANDBOX_HOST` or `pnpm sandbox:up`) and one model
  that runs on pi. Settings → Models → Default models → **New Code threads**
  picks the model a thread starts on; unset, it is the New bots model.
- **A project.** Every thread belongs to a project, so add one repository
  before the first thread (Projects, below).

With no harness configured, the sidebar has no **Chat / Code** switch and
bots have no `code_*` tools.

## The workspace

Three columns: the thread list, the open thread, and a work pane with four
tabs: Changes, Pull request, Files and Terminal. `Workspace.tsx` owns the
layout.

Every action has a key. `?` lists them. `:` opens the Code command menu
(`CodeCommandMenu.tsx`): this page's commands and its threads, nothing from
the rest of the app. The command palette (⌘K) also runs them by name. Plain letters act in the app; Shift letters post
to GitHub. The list of keys is the `commands` array in
`apps/web/src/client/pages/code/Workspace.tsx` (the workspace) and in
`PullReview.tsx` (a PR review); `keys.tsx` binds them. The ones used most:

| Key             | What it does                                           |
| --------------- | ------------------------------------------------------ |
| `j` `k` `u`     | Next thread, previous thread, next one that needs you  |
| `n` `v`         | New thread, review a pull request                      |
| `c` `Esc`       | Write to the agent; leave the composer, then stop      |
| `e` `t`         | Edit the last turn and run it again; run it again      |
| `1` `2` `3` `4` | Changes, Pull request, Files, Terminal                 |
| `` ` `` `\` `[` | Show or hide the terminal, work pane, thread list      |
| `z`             | Widen the work pane over the thread, and back          |
| `:` `?`         | Run a command or jump to a thread; list the keys       |
| `o`             | Open the worktree in Cursor or Zed                     |
| `f` `a`         | Fix CI, Address comments                               |
| `P` `M`         | Create the PR (or push to it), committing first; merge |

### The thread list

`ThreadList.tsx`. One line per thread, grouped by status, the ones that
need you first:

- **Needs you:** the agent asks something, a turn finished or failed and
  you have not read it, or its pull request waits for you. The row says
  which.
- **Working:** a turn is running. A workflow's name shows beside it.
- **In review:** it has an open pull request.
- **Done:** everything else, a merged pull request included.

Right-click a row for **Open PR** (when it has one), **Archive** (or
**Unarchive** under Archived) and **Delete**, which asks first. Archive and
Delete show only when the thread's harness can do them (`ThreadMenu` in
`ThreadList.tsx`).

The status is worked out from facts, never stored: `threadStatus` in
`apps/web/src/shared/code-status.ts`. Reading a finished thread moves it on.
With several projects, a row without a pull request names its project.
A plain unread finish shows only its dot and bold title, not the word
"finished". Pointing at a row a bot or project chat started says which.

Below the threads:

- **Reviews:** pull requests that wait for your review (below).
- **Archived:** folded, loaded when opened.

A harness that is not connected says so at the foot of the list, above
**Settings**.

### A thread

`ThreadView.tsx`, `Composer.tsx`, `Transcript.tsx`. The header shows the
project, the title, the branch and the pull request.

**Start.** `n` (or `/code/new`) opens the new thread dialog: the project
(the last one used is remembered), the agent when there are several, the
model and the permission mode, and the task. Enter starts it. The thread
gets its own worktree on a new branch from the freshly fetched base branch,
and its first message starts with one line naming the branch and telling the
agent to commit but not push.

**Write.**

- Enter sends. While the agent works, Enter **steers** (the message goes
  into the running turn) and Alt+Enter **queues** it for when the turn ends.
- A queued message can be edited, sent now or cancelled.
- `Esc` leaves the composer; `Esc` again stops the agent.
- `@` completes files and folders in the working directory where the harness
  can find files, and `/` hints the harness's commands.
- **+** attaches files and picks skills, where the harness takes them.
- The model, reasoning and permission chips sit in the composer.

**Watch.**

- Streaming text and thinking, and every tool call as a row: a command with
  its output and exit code, an edit with its diff, a subagent with its
  status, a plan as a checklist.
- **Approval and question cards:** Allow / Deny, or pick answers. They show
  only for a harness that asks.
- Errors come with **Retry** or **Try another model** where the harness
  offers them.
- A finished turn folds its work behind one "Worked for…" row, leaving your
  message and the answer in view. A running turn stays fully in view.
- What the app wrote for you reads short: a thread's first message shows its
  branch above your words instead of the agent's instructions, and a
  workflow request is one card, with **Show the full request**.
- Running background jobs and subagents show above the composer, each with a
  stop button, where the harness has them.

**Edit or retry a turn.** `e` edits the last turn and runs it again; `t`
runs it again as it was. Both are a **rewind** (`code.rewind.ts`):

1. The worktree goes back to the checkpoint taken before that turn. The
   state it replaces is checkpointed first.
2. The harness forks the conversation before that message, and the thread
   now points at the fork. The thread keeps its id, branch and pull request.
3. The conversation as it was is kept as an archived thread, "(before the
   edit)".
4. **Undo** in the toast puts the files and the conversation back.

Only a harness with the `threads.rewind` capability offers this: Native
today. The agent must be stopped first.

**Suggested next message.** After a turn, the composer shows what you
will likely say next in grey (for example "get it merged to main"); `Tab`
takes it. While you type a single line, it offers the rest of the line the
same way. One small call to the cheap title model (role `chat_title`) per
finished turn, and one per pause in typing only when the line no longer
matches the last suggestion. The prompt holds just the last user message
(300 characters) and the end of the agent's reply (900 characters), the
reply is capped at one short line, and answers are cached per turn
(`code.suggest.ts`, `use-next-message.ts`). With no model set up it shows
nothing.

**Archive.** The command palette archives or restores the open thread. An
archived thread offers **Unarchive to continue** in place of the composer.

### The work pane

Three tabs beside the thread, drawn by `ReviewPanel.tsx`, `PullPanel.tsx`
and `FilesPane.tsx`. `\` hides and shows the pane. Drag the divider to
resize it. `z`, or the widen button in the pane's tab row, lays the pane over
the thread list and the thread so it fills the page; `z` again puts it back.

**Changes (`1`).** The branch, its base and how many commits it is ahead,
then everything since the merge base with the base branch, committed or not,
new files included. Every changed file sits in one scrolling column, drawn
by @pierre/diffs, with a file tree behind **Files**.

- It stays live while open: the server watches the worktree and the pane
  re-reads in place when files move (ADR 0025).
- **Viewed** folds a file; the mark comes off when the agent changes the
  file again. **Edit** opens the light editor.
- The scope picker shows what any one turn changed. **Revert to here** puts
  the files back as they were after that turn, as uncommitted changes.
  Commits, and anything pushed, stay.
- **Comments.** Click a line number, or drag a range, to comment. Comments
  wait above the composer and go with your next message, ahead of your
  words; **Send now** sends them on their own. They are kept per thread on
  the server.

**Pull request (`2`).** See Pull requests below.

**Files (`3`).** The worktree as a folder tree (@pierre/trees) with file
icons, the agent's changed files marked and their folders open. `p` filters
the tree by name; `s` searches inside the files, and its hits, grouped by
file, take the tree's place until cleared. A file opens beside the tree, with
its path, whether the branch changed it, and a copy button, in the light
editor (@pierre/diffs' code
editor, `LightEditor.tsx`); ⌘S saves. A save is refused when the file
changed since it was opened, and for anything that is not a regular file
inside the worktree.

### The terminal

The work pane's Terminal tab (`4`, or `` ` `` to show and hide it) is a shell
on the sandbox that starts in the thread's worktree (`TerminalPane.tsx`, on
the same terminal service as the Terminal page). Switching tabs keeps the
session; coming back reattaches to it.

### Open in editor

`o`, or the arrow button at the end of the thread header, opens the thread's
worktree in **Cursor** or **Zed** over SSH (`OpenInEditor.tsx`; the links
are built by `apps/web/src/client/lib/code/editor.ts`):

- Zed: `zed://ssh/[user@]host[:port]/path`, from
  [Zed's remote development docs](https://zed.dev/docs/remote-development).
- Cursor: `cursor://vscode-remote/ssh-remote+host/path?windowId=_blank`, the
  VS Code `vscode-remote` link under Cursor's scheme, in a new window.

The dialog prefills the SSH host from `GET /code/status`, which gives each
harness an `ssh` target (`code.editor.ts`): Shelley's host from
`SHELLEY_URL`, the other harnesses' from `SANDBOX_HOST`, `SANDBOX_USER` and
`SANDBOX_PORT`. The user is `SANDBOX_USER`, else `exedev` (the sandbox
connection's default), or the app's own OS user when the files live beside
the app. A loopback host becomes the host the page was opened on, so an app
on `tiny-agents.exe.xyz` suggests `tiny-agents.exe.xyz`; a page on
`localhost` suggests `127.0.0.1`, because macOS resolves `localhost` to
`::1` first and the local sandbox publishes its port on IPv4 only.

When the target needs a port or a key, as the local Docker sandbox
(`pnpm sandbox:up`) does, the dialog suggests the `tiny-agents-sandbox`
alias and shows the `~/.ssh/config` entry to add once (host, port, user and
the absolute `SANDBOX_SSH_KEY_FILE`). Cursor's SSH links take a config alias
more reliably than a `host:port`. The editor and each harness's host are
remembered in this browser. The button is hidden on phones.

### On a phone

One column at a time: the list, then the thread. A thread opens on the
conversation, and the work pane covers it only when asked for; its close
button returns to the thread.

### Away

A followed thread sends a push (Settings → Notifications → _Code updates_)
when it finishes, fails or asks for you while no tab shows it. Pull request
pushes are listed under Auto-fix.

## Projects and GitHub

A project is a GitHub repository cloned on the sandbox
([ADR 0021](../adr/0021-code-projects-and-worktrees.md),
[ADR 0022](../adr/0022-github-through-gh-or-a-token.md)). **Settings** at
the foot of the list opens `/code/settings` (`CodeSettings.tsx`):

- **GitHub** (`/code/settings/github`). Either save a fine-grained token
  for the project's repositories (kept as an `app` vault item for the
  `github` sink; API calls go from this server, and only `git push` runs on
  the sandbox, with the token on that command's stdin), or sign `gh` in with
  `gh auth login` from the Terminal page. The page says which is active and
  whom it acts as, and sets up the optional GitHub App (below).
- **Projects** (`/code/settings/projects`). **Add a project:** `owner/name`
  or a GitHub URL, or, with the GitHub App, a list of the repositories it is
  installed on. The app checks the sandbox has `git` (and `gh` without a
  token) and that the credential reaches the repository, then clones it.
- **A project's page** (`/code/settings/projects/<id>`): its name, base
  branch, branch prefix, default agent and model; the script overrides; the
  pull request switches; Auto-fix with its triggers, **Instructions for
  every workflow**, trusted review bots and protected paths; the Auto-fix
  limits; and **Remove**. The settings and their defaults are
  `ProjectSettings` in `apps/web/src/shared/api/code.ts` and
  `DEFAULT_PROJECT_SETTINGS` in `code.projects.ts`.

**Scripts** are read from a checked-in `.tiny-agents/code.json`:

```json
{
  "setup": "pnpm install",
  "check": "pnpm test",
  "archive": "rm -rf node_modules"
}
```

`setup` runs in a new worktree before the first turn (a failure is reported
to the agent; the turn still starts). The agent is told to run `check`
before it reports done. `archive` runs before a worktree is removed.

**Branch names.** The branch is named for what the task does, short:
`ta/fix-google-callback`. One side-call on the `chat_title` model role reads
the task and answers the thread's short title and the branch
(`code.naming.ts`). With no model, a failed call or an unusable answer, the
branch is the task's first words without the filler. A name already taken
gets `-2`, `-3`, …. The `ta/` before it is the project's **Branch prefix**.

**Each thread's commits** carry `Thread-Id: <thread id>`, so `git log` leads
back to the conversation.

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

## Pull requests

The **Pull request** tab (`PullPanel.tsx`, `PullChecks.tsx`,
`PullComments.tsx`).

**One action at a time.** The tab leads with the step the branch needs
(`pullStage` in `lib/code/pull-stage.ts`):

- **Nothing to publish yet** until the agent changes files.
- **Create PR (`P`)** with an optional title (written from the commits if
  empty). When the agent left files uncommitted, it reads **Commit and create
  PR**: the app commits them, titled after the thread, then pushes (never
  forced, hooks off) and opens a draft PR, or a ready one when the project's
  **Open new PRs as drafts** is off.
- **An open PR** (below). When files changed since the last push, **Commit and
  push** sends them.
- **Merged into main on this machine:** the agent merged the branch into the
  checkout's base branch without pushing. **Push main** pushes it,
  fast-forward only (`POST /code/threads/:id/push-base`); **Create PR
  instead** opens a pull request from the branch.
- **In main on GitHub:** the work reached the base branch without a pull
  request, or its PR merged. **Archive thread** ends the thread. After a
  squash-merged PR only commits made since count, so Create PR does not come
  back.

An open PR for the thread's branch, or for the branch its worktree has
checked out, links on its own when a turn ends or the tab opens
(`linkByBranch` in `code.pulls.ts`). **Link an existing PR**, in the tab's
menu, is for a PR from some other branch.

**Next steps.** When a turn ends, the thread shows the same states as
buttons above the composer (`NextSteps.tsx`): Create PR and Review changes,
Commit and push or Merge on an open PR, Push main, and Archive.

**The tab.** The PR's number, state, title and `branch → base`, then:

- **Checks:** counts over a bar, then a row per check, failing first. A row
  opens to its **Log excerpt** for an Actions job. **Fix CI** shows when one
  fails.
- **Comments:** every conversation comment, review and line thread, newest
  first, under **All**, **Humans** or **Bots**. An open line thread can be
  added to the message; **Attach all comments** puts them all in the
  composer. **Address comments** hands them to the agent.
- **Merge (`M`)** with the repository's methods, once checks pass and there
  is no conflict. **Resolve conflicts** shows when the branch no longer
  merges.
- **YOLO Merge** merges without you. It resolves every open review thread,
  marks a draft ready, then waits until no check is pending or failing and
  GitHub can merge the branch, and squash-merges (or the repository's only
  method). Threads opened while it waits are resolved too. It looks every
  30 seconds, and the tab says what it waits for; **Call off** stops it.
  `armYoloMerge` and `yoloStep` in `code.pulls.ts`, the waiting rule in
  `code.yolo.ts`.
- The **Auto-fix** and **Draft** switches, the pass history, the
  description (**Edit** saves it to GitHub), **Review** (opens a PR review
  of it) and **Unlink**. After a PR merges, the next Publish opens a new
  one; earlier PRs are listed.

While the tab is on screen it re-reads and reconciles with GitHub, so a
project with no webhooks shows a finished check quickly.

## Workflows

A workflow is work the agent does in a thread without you writing the
request. Each one is a run with trigger `workflow` (`code_runs`,
`code.runs.ts`), and the thread list shows its name while it works. The
names are `WORKFLOW_LABEL` in `apps/web/src/shared/code-status.ts`.

| Workflow              | Starts from                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| **Fix CI**            | `f`, the button on a failing check, or Auto-fix                        |
| **Address comments**  | `a`, the button on the Pull request tab, or Auto-fix                   |
| **Resolve conflicts** | the button on the Pull request tab, or Auto-fix                        |
| **Fix issue**         | a new thread whose task contains a link to one of the project's issues |
| **Review PR**         | `r` in a PR review                                                     |

- **Fix issue.** Paste the issue's link into the new thread dialog. The app
  reads the issue from GitHub and adds its title and text to the first
  message (`issueFor` in `code.routes.ts`).
- **By hand.** `POST /code/threads/:id/workflows/:name` starts one pass now.
  When there is nothing to do it says why instead of starting.
- **Instructions for every workflow** (project settings) are added to the
  end of each workflow's request (`withWorkflowInstructions` in
  `code.projects.ts`).

### Auto-fix

[ADR 0023](../adr/0023-auto-fix.md). While a PR's **Auto-fix** switch is on,
the app watches the PR and starts a pass for a failed check, a trusted
review or comment, or a merge conflict, after a quiet period:

- The pass is sent to the thread (queued behind a running turn) with the
  log tails and comments inside a block marked untrusted, and fixed
  instructions: fix root causes, never weaken a test, do not edit CI
  workflow files, run `check`, commit, end with an `autofix-report` block.
- When the turn ends, the app pushes. It does not push a pass with no new
  commit, one that touches a protected path, or one GitHub rejects; the
  loop then waits for you. It replies to each fixed thread with the commit
  and resolves it; without a report it posts one summary comment and
  resolves nothing.
- Trusted: you, the repository's owners, members and collaborators, and the
  review bots you list. The app's own comments never start a pass. PRs from
  forks are never fixed. Approvals never start a pass.
- Limits: passes in an hour, passes in a row without you, and minutes a
  pass may run. The defaults are `DEFAULT_AUTOFIX` in `code.autofix.ts`;
  each project can change them. Writing in the thread moves a waiting loop
  on.
- A pass runs in the thread's own permission mode: anything the harness
  asks waits for you.
- Pushes (Settings → Notifications): **Auto-fix needs you** and **Pull
  request updates**. None while the thread is on screen.

The pure decision is `decide` in `code.autofix.ts`; `code.passes.ts` runs a
pass. Both the loop and the pass are typed machines
([State machines](../reference/state-machines.md)).

## PR reviews

Review any pull request of a project's repository, your own or someone
else's, with the agent's help. Nothing is posted until you submit.

**Open one.**

- **Reviews** in the thread list (`ReviewList.tsx`) shows the pull requests
  that wait for you: review requested, or updated since your last review,
  read from GitHub across every repository the credential sees. A click
  checks the PR out and opens its review. A PR of a repository that is not a
  project opens on GitHub instead. Reviews already open here are listed
  too, each with **Close review**.
- `v`, or the **+** beside Reviews, takes a PR's link or `owner/name#123`.
- A link opens one straight into review: `/code/review?pr=<link or
  owner/name#123>`, `/code/review/<owner>/<name>/<number>`, or GitHub's own
  path after `/code/review/`.
- A thread's Pull request tab offers **Review** for its own PR.

Opening the same PR again reuses its review.

The review assistant runs in **YOLO mode** (never ask) when its harness
offers `bypassPermissions`; a harness without it falls back to ask mode.

**What opening does.** The app fetches the PR's head (`refs/pull/N/head`,
so a PR from a fork works) and its base into the project's clone. When a
Code thread opened the PR and its worktree is at that head, the review
shows that worktree as it is. Otherwise the app checks the head out in a
detached worktree of the review's own. The page reads files and diffs from
git there, against the PR's base. **Update** (the header's refresh) moves
the review to the PR's latest commit. **Close review** removes the review's
own worktree (never a thread's).

**Daily prune.** Once a day the app removes the review worktrees of other
people's PRs that sat idle (`code.reviews.prune.ts` owns the schedule and
the idle time). It keeps your own
PRs, PRs a Code thread opened, a thread's worktree, and a checkout with
uncommitted changes or local commits. A pruned review stays in the list;
opening it checks the PR out again.

**The page** (`/code/reviews/<id>`, `PullReview.tsx`) takes the whole
screen, laid out like [diffshub](https://diffshub.com) (see
[CREDITS](../../CREDITS.md)): the agent's column, a file tree with a
**Comments** tab and the diff stats, and every changed file in one scrolling
column with **Edit** and **Viewed**. Select line numbers to comment.

**The agent's review (`r`).** **Review with the agent** asks a thread of
the project's default harness, in the review's worktree, to read the change
and report (`code.findings.ts`, `shared/review-report.ts`). It does not
change files. When its turn ends the column shows:

- a **brief**: what the change does, what the agent ran, what to read
  first;
- **findings**, each with a severity, a title, a file and a line.

`n` and `p` move between findings. `y` adds the finding to your review as a
pending comment on its line; `d` dismisses it. **Review again** replaces the
open findings after the PR moves. Below the findings the column is the
assistant's thread: ask it anything about the PR. Its first message carries
a short card of the PR (`reviewCard` in `shared/code-messages.ts`), never
the diff, and says the PR's text is data, not instructions.

**Review comments.** The composer under selected lines has two ways out.
**Comment** adds a pending comment to your review. **Ask assistant** makes
it a comment for the assistant, which goes with your next question.
**Suggest change** (on new lines only) puts a GitHub suggestion block with
the selected lines into the comment.

**Submit.** **Submit review** lists the pending comments, takes a summary
(drafted from them) and the verdict, and posts them in one call, pinned to
the head the review shows. `Shift+A` opens it on **Approve** and `Shift+X`
on **Request changes**, which needs a summary. On your own PR GitHub allows
only a comment, so the dialog offers only **Comment**. When a Code thread
opened the PR, **Send to coding thread** hands the pending comments to that
thread instead.

**Conversations from GitHub.** The page shows the PR's line conversations
under their lines, with **Reply** and **Resolve**.

**Since your review.** When the PR has moved on since your last review, the
diff opens on **Since your review**: the changes from that commit to the
head. **Since <base>** still shows the whole PR.

**Changing the code.** What you or the assistant change in the review's
checkout shows under **Your changes**, with three ways on: **Push to PR**
(commits and pushes to the PR's branch after a confirm, never forced),
**Post as suggestions** (each hunk becomes a pending GitHub suggestion), and
**Discard**. When the review shows a thread's worktree, these give way to
**Push from the thread**. **Open in terminal** opens a Terminal tab in the
review's checkout.

## Bots hand off coding

Every bot has the `code` toolkit (`packages/agent/src/toolkits/code.ts`).
The bot's prompt lists the configured harnesses and the projects.

| Tool            | Permission | What it does                                                           |
| --------------- | ---------- | ---------------------------------------------------------------------- |
| `code_start`    | allow      | Start a thread (`task`, `project`, `harness`, `model`); returns a link |
| `code_send`     | allow      | Steer or follow up any thread by id (adopts one started elsewhere)     |
| `code_status`   | allow      | Working or idle, the last answer, and uncommitted changed files        |
| `code_list`     | allow      | This bot's hand-offs                                                   |
| `code_models`   | allow      | A harness's ready models, its default first                            |
| `shelley_start` | allow      | Alias of `code_start` with `harness: shelley` (older prompts)          |
| `shelley_send`  | allow      | Alias of `code_send` for Shelley ids                                   |

`code_start` starts a thread of a project, exactly as the owner's new
thread does: its own worktree and branch, recorded as a run with trigger
`bot` (`startOnce` in `code.bots.ts`). `project` is the project's name or
`owner/name`. It may be left out when there is one project; with several,
the tool answers with their names. With none, it says to add a repository
first. The harness is the one named, else the project's default agent, else
Shelley.

The chat shows a hand-off as a card with the live state and **Open in
Code**. When the turn ends, the outcome arrives once as "Reply from
<harness>" (untrusted peer text), in the conversation that last asked;
nothing polls:

- from the bot's chat: that chat;
- from a routine run: that run's conversation, unattended and on its token
  budget, never the bot's chat;
- from the bot's answer to another bot: that answer's conversation, and what
  the bot says there is relayed back to the bot that asked.

A follow-up (`code_send`) moves the hand-off to the conversation that sent
it. A finish is recorded as owed before it is sent, so one cut off by a
restart or a failed send is sent again until it lands; the chat takes it
once. A replayed `code_start` makes one thread, and a follow-up is armed to
report back before the harness hears it.

Known limits (register row C7):

- A start whose thread creation fails after the harness already made the
  thread (a client timeout, say) drops its claim, so a replay of that tool
  call can make a second thread. Harnesses take no idempotency key to
  prevent it.
- A finish that can never be delivered (its bot's chat keeps refusing the
  submit) is retried, and logged, for as long as the app runs. Deleting the
  bot removes it.

## Project chat

Each project has one chat, a bot tied to it (`bots.project_id`), opened from
the top of the Code sidebar and made on first open (`code.chat.ts`, ADR
0040). On a phone the chat's menu button goes back to the thread list. It
coordinates instead of coding: its `project` toolkit
(`createProjectToolkit` in `packages/agent/src/toolkits/code.ts`) starts and
follows up threads of that project only, lists them with their state,
branch and PR (`code_list`), and archives finished ones (`code_resolve`).
Its toolkits are `PROJECT_BOT_TOOLKITS` in `bot-toolkits.ts`, so it has no
browser or computer.

A side panel sits beside the chat (`ProjectPanel.tsx`), shown or hidden
with the header's Threads button. Its **Threads** tab lists the project's
threads with a search box, grouped by state (`statusSections`, Done and
Archived folded), each with a one-line status (`statusLine`) and its PR.
A row opens that thread inside the panel (`?thread=<id>`): its live
transcript, a branch and PR bar, and the composer to steer it, with a back
arrow to the list and a button to the full thread. Its **Context** tab
shows the repository, the Instructions and the chat's memory. On a phone
the chat comes first and the panel opens over it, full screen.

The project's **Instructions** (Settings, the project's page) go into the
coordinator's prompt and into the first message of every thread of the
project, folded out of the transcript like the rest of the preamble.

Threads the chat started or adopted report back to it (`code.report.ts`):
when one waits for the owner, and when its PR opens, goes green, fails
checks, needs the owner or merges. Each note is one short line with a link,
owed in the hand-off finish outbox (`code_handoff_finishes`) so a restart
does not lose it. The watcher's sweep sends what is owed to one chat as a
single turn, so a burst of news costs one turn, not several. Threads the
owner started report nothing. A finish keeps its first 1,500 characters and
points to the thread for the rest.

## Known gaps

- Shelley and Claude Code threads cannot edit or retry a turn.
- A review is its own screen, not a thread; the agent does not review a PR
  on its own when a review is requested.
- The Android app has no terminal or file editor; it lists, steers,
  edits and retries threads, shows Changes and the pull request, runs
  workflows, and reviews PRs with the agent's brief and findings.
- Not built: re-running a flaky check before spending a pass, mention
  commands from PR comments, and a preview script.

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
    and session history normalized. Shared connections reach it as one in-process
    SDK MCP server per connection (`appServers` in
    `packages/claude-worker/src/coding.ts`); a call comes back to the app as a
    `tool_call` event and runs through `claudeCodeTools`
    (`apps/web/src/server/api/code/code.tools.ts`), answered with
    `coding.tool_result` (ADR 0042).
  - `pi`: the native harness (below). It takes the agent runtime through
    `PiPort` (`port.ts`), normalizes its chat state, and keeps its threads in
    the app's thread index.
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
  the watcher only reads it.

- **App:** `apps/web/src/server/api/code/`:
  - `code.registry.ts`: which harnesses run, from env.
  - `code.hub.ts`: starts every instance, caches the decorated lists, counts
    viewers.
  - `code.watcher.ts`: delivers hand-off finishes and sends pushes.
  - `code.routes.ts`: `/api/v1/code/*`.
  - `code.threads.ts`: a thread's own id and its harness address
    (`threadRef`, `threadKey`), attention, and the decorated list.
  - `code.runs.ts`: runs (`code_runs`), one per turn the owner, a workflow
    or a bot started.
  - `code.rewind.ts`: edit and retry a turn, and Undo.
  - `code.findings.ts`: the agent's review of a PR and its findings.
  - `code.bots.ts`: the bots' `CodeStore`.
  - `code.store.ts`: the tables.
  - `code.projects.ts`, `code.workspace.ts`: projects, and git on the
    sandbox (worktrees, base-branch diffs, the push rules).
  - `code.github.ts`: the GitHub client and git credential, from Settings.
  - `code.pulls.ts`, `code.pulls.store.ts`: PR links, Publish, the
    reconcile chain (`code-pr-reconcile`) and the PR tab.
  - `code.autofix.ts` (the pure `decide`), `code.passes.ts` (a pass).
  - `code.checks.ts`: a check's log excerpt for the PR tab (`GET
    /code/threads/:id/pr/checks/:job/log`, only for the open PR's checks).
  - `code.checkpoints.ts`: per-turn checkpoints and revert.
  - `code.review.ts`: line comments, viewed marks and file saves for the
    Changes pane and a PR review.
  - `code.changes.ts`: the live Changes pane (ADR 0025): while one
    is open, one poll per directory reads its change stamp and
    `GET /code/threads/:id/changes` pushes a version when it moves.
  - `code.webhook.ts`: the GitHub App's signed webhook (public).
  - `code.reviews.ts`: PR reviews (open, the assistant's first question,
    pending GitHub comments, submit, the PR's conversations, close), with `/code/reviews` routes in `code.projects.routes.ts`.
  - `code.projects.routes.ts`: `/api/v1/code/{projects,github,reviews}` and
    a thread's `pr`, `publish`, `review`, `files`, `terminal` and
    `workflows` routes. `rewind` is in `code.routes.ts`.
- **Tables:**
  - `code_threads`: every thread, under its own id, with its project,
    branch, worktree, harness address and how far you have read it.
  - `code_runs`: the runs of a thread, with their trigger and workflow.
  - `code_handoffs`: the hand-offs, `starting → running → finished`
    compare-and-set, each with the conversation that last asked.
  - `code_handoff_finishes`: finishes owed to bots, until delivered.
  - `code_projects`; `code_pull_requests` (a cache of GitHub plus the
    Auto-fix loop); `code_autofix_passes`; `code_pr_comments` (the app's own
    comments); `code_review_viewed` and `code_review_drafts`;
    `code_checkpoints`; `code_pr_events` (webhook deliveries, by id);
    `code_reviews` (PR reviews: the PR, its worktree, assistant and brief);
    `code_findings` (the agent's findings in a review).
- **Client:**
  - `lib/code/`: API, live thread hook, the status-grouped list, tool
    folding.
  - `store/code.ts`: the app-wide list stream.
  - `pages/code/`: the workspace (`Workspace.tsx`); `CodeSettings.tsx` is
    `/code/settings`.

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

## The native harness

[ADR 0020](../adr/0020-native-code-harness.md). A Native thread is a conversation in the same agent runtime the
chat bots use, with a working directory and five coding tools.

- **Tools** (`packages/agent/src/toolkits/coding.ts`): `read`, `write`,
  `edit` (exact text, answers with the diff), `bash` and `find` (file
  names). Each runs on the sandbox through the one sandbox connection, never
  on the app's host. A relative path is under the thread's working
  directory, and commands start there.
- **Permission modes** are the Tool gate's per-tool permissions
  (`codingSelection`): Default asks before `write`, `edit` and `bash`;
  Accept edits asks before `bash` only; Plan takes the three away and tells
  the agent to plan; Bypass asks for nothing. A call that asks is an
  approval card, and the agent's own question is a question card.
- **Connections:** every connection shared with every bot (`allBots`) is
  offered, deferred behind `tool_search`, with Settings > Tools deciding
  allow, ask or off ([ADR 0042](../adr/0042-code-threads-use-shared-connections.md)).
  The mode's permissions cover only the coding tools.
- **While it works:** a message steers (it joins after the running tool
  round, and waits in the queue until then) or is held with the queue
  button. A held message can be sent now, which makes it a steer, or
  cancelled. Stop ends the turn, stops waiting for a running command and
  withdraws what is queued.
- **After it stops:** `/compact` (with optional instructions) summarizes
  the conversation. Edit and retry fork the conversation before the message
  (`forkBefore`).
- **Not served:** deleting a thread, attachments, effort levels, and the
  harness's own workspace calls (diffs, file search, folder browser). The
  app reads a project thread's changes and files itself.
- **Without a model key:** with `TINY_AGENTS_FAUX=1` the faux model runs the
  tools on `/bash <command>`, `/read <path>`, `/write <path> <text>`,
  `/edit <path> <old> => <new>`, `/find <query>` and `/sleep <seconds>`.

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
- **Native:** the driver runs on the real agent runtime with a scripted
  model (`tests/server/code/pi/`), and the tools against the fake sandbox
  SSH server (`tests/server/app/agent/coding-toolkit.test.ts`).
- **Shelley by hand:** run Shelley with its keyless test model:

```bash
shelley -predictable-only -db /tmp/shelley.db serve -port 9000
```

Then send `bash: ls`, `subagent: lint bash: echo ok`, `patch success`,
`delay: 10` (steer or queue while it runs) or `tool smorgasbord`.
