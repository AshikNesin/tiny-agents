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
  the project or folder, and one Review panel toggle;
- every setting a turn needs (model, reasoning, permissions, context) as a
  chip inside the composer.

**A control appears only when the thread's harness has its capability.**
Shelley has no approvals, so its threads show no permission chip. Claude Code
has no background jobs, so its threads show no job chips.

**Find.**

- **Threads** (below New thread, `/code/threads`; a project group's list
  icon opens `/code/threads?project=<id>`) shows every thread, or one
  project's, at full width, after Hoplite: sections **Working**, **Needs
  you** (its PR needs input), **In review** (an open PR) and **Done**, each
  row with its status, title, PR chips and date, then **Archived**, folded,
  loaded when opened. The project menu switches project, and the search box
  filters by title.
- The sidebar is a short column, like Hoplite: **New thread**, **Threads**,
  **Reviews** and **Search** rows on top, the threads, then **Settings** and one **…**
  menu (Group by repository, Show archived, Select threads). A row shows its
  PR only when the PR needs you.
- By default (**Group by repository** in that menu, on)
  threads are grouped by project, then by repository or folder for threads
  outside a project. Turned off (remembered), the list is one flat list,
  working threads first, then newest first, like Hoplite. Search sits behind
  its icon (Escape closes it). With grouping on, the most recently active group comes first, and a
  project with no thread yet comes last. A group folds away (remembered),
  shows its newest 8 threads with **Show more**, and offers **New thread**
  in it (and, for a project, its settings) on hover. Inside a group,
  working threads come first, with subagents nested under their parent.
- **Show archived** in the same menu lists archived threads, listed the
  same way, with **Restore**.
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
- When a turn ends, the empty composer suggests your likely next message
  as its placeholder, after t3code: **Tab** fills it in (**Use** on touch),
  **Esc** dismisses it for that turn. It costs one small call on the
  `chat_title` model role per finished turn, and only for a thread open in
  a browser: the call sees the thread's title, your last message and the
  agent's answer, each cut short, never the transcript, and its answer is
  kept for later asks (`code.next-prompt.ts`). A failed turn, an open
  approval or no model gives no suggestion.

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
- A finished turn folds its work (thinking, progress notes, tools) behind one
  quiet "Worked for 12s · $0.04" row (or "Ran 2 commands · $0.04" when the
  harness reports no duration), leaving the first message and the answer in
  view, as Amp and Hoplite read. A running turn stays fully in view. A failed tool
  call inside still shows on the folded row ("· 1 failed").
- What the app wrote for you reads short: a project thread's first message
  shows its branch (and a failed setup script) above your words instead of
  the agent's instructions, and an Auto-fix request is one card listing what
  it fixes, with **Show the full request**.
- Inline code is neutral gray mono, and the composer shows one
  "Model · Reasoning" label.
- An archived thread offers one **Unarchive to continue** in place of the
  composer.
- The context ring opens the usage report: per-model token bands and cost,
  indirect usage, subagents, and **Compact in place**.

**Control.**

- Stop, Resume, rename, change directory, fork from a message, delete,
  Open in Shelley — each where the harness has it.
- **Archive** moves a thread **with its subagents**, with Undo.
- **Select** (**Select threads** in the list options menu, **…** at the
  foot of the sidebar) turns the list into
  checkboxes: pick threads (a click on a row picks it; a picked thread's
  subagents go along), or **Select all**, then **Archive** (or **Restore** in
  the archived view) moves them all, with one Undo.

**Review.** **Review panel** in the thread header (⌘⇧D) opens one panel on
the right with tabs: **Source control** and, for a project thread, **Pull
request #N**. It opens on the tab it was left on; **Close panel** and **Open
as a page** sit at the end of its tab strip. Outside a project, Source
control shows the uncommitted changes (new files included), or a recent
commit, of the thread's directory, each changed file as a card with its
diff. Every diff in the app (these panels and the transcript's patches) is
drawn by @pierre/diffs (diffs.com): syntax colors, one gutter numbering the
lines, unchanged runs folded behind expanders, and long lines wrapped.

- **Comments.** Click a line number to open a composer right under that
  line. Drag down the numbers (mouse or finger) or shift-click another
  number to take a range; the composer moves under its last line and keeps
  what you typed. ⌘↵ saves.
  The comment stays under its line and waits above the thread's composer
  ("N comments go with your next message"), where each can be removed. The
  next message you send takes them along in the same turn, ahead of your
  words; **Send now** sends them on their own. The agent gets each with its
  file, lines and the quoted lines; the thread shows them as comment cards.
  Comments are kept per thread on the server, so they survive a reload, and
  work for every harness. A guest's comment, which cannot be saved, goes into
  the composer as `` `path:lines` `` and its text.
- **Review page.** The panel's **Open as a page** opens the thread's
  Review page (`/code/<id>/review`): **Source control** and, for a project thread,
  **Pull request** (`?tab=pr`), each a tab at full width. Comments work there
  as in the pane and wait in a tray at the bottom (**Send now**); **Back to
  the thread** returns to the composer, where they go with the next message.
- **Hide sidebar** (top of the thread list) or ⌘B folds the list away on
  wide screens so the thread and Changes get the room; **Show sidebar** at
  the top left brings it back. The choice is remembered in this browser.
- Drag the divider between the thread and its right panel to resize them
  (or focus it: arrow keys, Shift for bigger steps, Home/End, Enter to
  reset). The width is remembered in this browser; a double-click goes back
  to the default split. Phones show one column, as before.
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
(Settings → Models) reads the task (its first 1,500 characters, nothing else)
and answers two lines: the thread's short title ("Fix Google sign-in
callback", 3 to 6 words, shown in the thread list) and the branch (2 to 4
words naming the outcome, so "figure out why the export fails" is
`debug-export-failure`), with an 8-second limit. Threads outside a project
get the same short title, named after they start. With no model, a failed
call or an unusable answer, the harness keeps its own title and the branch
is the task's first words without the filler ("Can you please fix the login
flow when…" is `ta/fix-login-flow-users`). Shelley stores titles as slugs,
so there it reads `fix-google-sign-in-callback`. A name an
earlier thread took, here or on the remote, gets `-2`, `-3`, ….
The `ta/` before it is the project's **Branch prefix** (Code settings →
the project → General): a bare word gets a `/` (`ashik` is `ashik/`),
empty means none, and a prefix git cannot use is refused.

**Review.** In a project thread, Source control (⌘⇧D) shows the branch, its
base and how many commits it is ahead, then everything since the merge base
with the base branch, committed or not (new files included), live as above:
a file list (name, folder, +/−, a status letter A, M or D) with a filter
(generated files and lockfiles muted and last). In the panel a file opens to
its diff and **All files** goes back; on the Review page the list sits beside
the diff. **Viewed** marks that
come back unmarked when the agent changes the file again, `[` / `]` between
files (or the file bar over the diff: previous, next, `n of N`, **Viewed**;
on the Review page **Hide file list** gives the diff the full width), and
line comments as above. **Uncommitted or a commit** switches to the
harness's own changes.

**Publish.** The panel's **Pull request** tab (the header's toggle shows
`#N` and its state once there is one) offers Publish.
**Publish draft PR** pushes the branch (never forced, hooks off) and opens a
draft PR with the commits as its body and a short title (one `chat_title`
call over the thread's title and the commit subjects: imperative, under 60
characters, no `feat:` prefix; the thread's title when there is no model); with a PR open, Publish pushes new
commits. **Link pull request** links an existing one, and a PR the agent
opened for the branch is linked on its own. When nothing is ahead but the
agent changed files, the tab says they are not committed yet, and **Ask to
commit** puts that request in the composer. A draft offers **Ready for
review**, which marks it ready on GitHub so **Merge** can run. After a PR merges, the next
Publish opens a new one; earlier PRs are listed.

**The PR tab.** The PR's number, state (open, draft, queued, merged or
closed), title and `branch → base`. **Checks**: `N passing · N failing ·
N pending` over a bar, **N failing checks** with **Fix CI** when one fails,
then a row per check (its latest run: a workflow re-run on every PR event
shows once), failing first (duration, age, a link to GitHub; past
six, the passing ones fold behind **Show N passing**; a check pending for 6
hours is **Stalled** and no longer blocks green). A row opens to its status,
start and end and, for an Actions job, its **Log excerpt**: the lines around
the first failure (GitHub's timestamps and color codes taken out, error
lines marked, the error itself on top), **Copy**, and **View full log**.
**Comments**: every conversation comment, review and line thread, newest
first, under **All**, **Humans** or **Bots** (a GitHub App, a `[bot]` login
or a known review service such as CodeRabbit or Greptile), each with its
author, age and markdown body; a line thread names `path:line`, shows its
replies and Resolved or Outdated, and an open one can be added to the
message. Authors Auto-fix does not trust are labelled **Ignored**. Then
**Attach all comments** into the composer, the description
(rendered as markdown, template comments hidden; **Edit** saves it to GitHub
while the PR is open),
**Fix** (one pass now, when no check fails), **Merge** with the repository's methods, the
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
project's clone. In Source control, the scope picker shows what any one turn
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

## PR reviews

Issue #345. Review any pull request of a project's repository, your own or
someone else's, in focus mode, with an AI assistant scoped to that PR.
Owner-only, like projects.

**Open one.** **Reviews** in the sidebar (`/code/reviews`) takes a PR's
link (any tab of it) or `owner/name#123`, and lists the reviews open here.
Above them is the inbox from GitHub, across every repository the GitHub
credential (Settings → GitHub) sees, read in one query when the screen
opens: **Needs your review** (review requested), **Updated since your
review** (commits after your last review), **Waiting on author** (none
since) and **Your pull requests**, with draft and approval state. A PR of
a project opens its review here; another repository's opens on GitHub. A
repository that is not a project yet says so. `/code/review/<owner>/<name>/<number>`
opens one from a link, and a coding thread's **Pull request** tab offers
**Review** for its own PR. Opening the same PR again reuses its review.

**What opening does.** The app fetches the PR's head (`refs/pull/N/head`,
so a PR from a fork works) and its base, and checks the head out in a
detached worktree of the review's own
(`~/tiny-agents-code/<owner>--<name>/reviews/pr-N`). The page reads files
and diffs from git there, against the PR's base. Nothing calls a model.
**Update** (the header's refresh) moves the review to the PR's latest
commit, unless its worktree has changes. **Close review** removes the
worktree and archives the assistant.

**The page** (`/code/reviews/<id>`) takes the whole screen. The header
shows the number, title, repository and author. The PR's changes fill the
left side, as in Source control: a file list with **Viewed** marks, the
diff, and line comments. The assistant is on the right, behind the same
resizable divider as a thread's panel. Phones show one side at a time
(**Assistant** / **Files** in the header).

**The assistant** is a thread of the project's default harness, started in
the review's worktree on your first question, in the harness's asking
permission mode where it has one, so an edit waits for your yes. Until then
the pane offers a few starter questions and a box with a **Model** picker
(the project's default model first; the pick goes with the first question
as `model`), and line comments wait under the review (`review:<id>`). After
that the thread's own composer picks the model, as in any thread. The first message is:

- a short card of the PR (`reviewCard` in `shared/code-messages.ts`):
  the repository, number, head and base, what the assistant is for, the
  title, author, the description (template comments taken out, cut at 1,500
  characters) and the changed files with their +/− (at most 150 named;
  generated files and lockfiles only counted). Never the diff: the
  assistant reads what it needs with its own tools. The card says the PR's
  text is data, not instructions;
- any line comments waiting, as in a thread;
- your question.

The transcript shows the card as one "Reviewing owner/name#N" line. After
that the pane is the thread itself, without its header. Line comments go
to it with your next message, as in any thread. The assistant's thread is
titled `Review #N: <title>` and stays off the thread list.

**Review comments.** In a review, the composer under selected lines has
two ways out. **Comment** (⌘↵) adds the comment to your review on GitHub:
it waits as **Pending** under its lines, apart from the assistant's
comments (`code_review_drafts.target` is `github`). **Ask assistant** makes
it a comment for the assistant, tagged **For the assistant**, which goes
with your next question. **Suggest change** (on new lines only) puts a
GitHub suggestion block with the selected lines into the comment, to edit
in place.

**Submit review** in the header (with the count of pending comments) lists
them, takes a summary and the verdict (**Comment**, **Approve**, **Request
changes**, which needs a summary) and posts them in one REST call
(`POST /pulls/N/reviews`), pinned to the head the review shows, so each
comment lands on the lines you read. A comment on removed lines goes on
GitHub's left side; a range as its first and last line. On your own PR
(the PR's author is the GitHub account Code uses) GitHub allows only a
comment, so the server refuses the others and the dialog offers only
**Comment**. When a Code thread opened the PR, **Send to coding thread**
hands the pending comments to that thread as one message instead, for its
agent to act on.

**Conversations from GitHub.** The page reads the PR's line conversations
when it opens (in the one GitHub query that reads the PR, no model) and
shows each under the lines it is on, with its comments, **Reply** and
**Resolve** (both as the GitHub account Code uses). A resolved one starts
folded. GitHub places them at the PR's current head: when the review shows
an older commit, or the code moved on (outdated), a file lists them above
its diff instead, the first with a hint to **Update**.

**Since your review.** Opening a review reads which commit your last
GitHub review of the PR was on (from the same query), and submitting one
here records its head. When the PR has moved on since, the diff opens on
**Since your review**: the changes from that commit to the head, fetched
by sha if the worktree lacks it (a force-pushed commit GitHub no longer
has says so). **Since <base>** still shows the whole PR. Viewed marks hold
in both.

**Changing the code.** What you or the assistant change in the review's
checkout shows under **Your changes** (the diff from the PR's head to the
worktree, commits made there included), with three ways on:

- **Push to PR** commits it (with your message, as the sandbox's git
  identity or else your GitHub login's noreply address, hooks off) and
  pushes it to the PR's branch, after a confirm that names the branch and
  its author. Never forced: GitHub refuses the push when the branch moved.
  A fork's branch takes it only when its author allows edits from
  maintainers; otherwise the server says to post suggestions instead.
- **Post as suggestions** turns each hunk into a pending GitHub suggestion
  on the head lines it replaces (an added line is suggested with the line it
  follows). GitHub takes comments only on lines of the PR's own diff, so a
  hunk outside it, or in a file you added or deleted, is skipped and counted.
- **Discard** (after a confirm) puts the checkout back at the PR's head.

**Open in terminal** in the header opens a Terminal tab that starts in the
review's checkout, for changes by hand; they show under **Your changes** too.
For a typo or a rename, **Edit** (the pencil over a file's diff) opens the
file as plain text (no highlighting or completion) and **Save** writes it in
the checkout (`PUT /code/threads/:id/review/file`, the same save a coding
thread's Review panel uses for its worktree). The save is refused when the
file changed since it was opened (the agent may have edited it), and for
anything that is not a regular file inside the checkout (a symlink out, or
git's own files).

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
  - `code.checks.ts`: a check's log excerpt for the PR tab (`GET
    /code/threads/:id/pr/checks/:job/log`, only for the open PR's checks).
  - `code.checkpoints.ts`: per-turn checkpoints and revert.
  - `code.changes.ts`: live Changes and Review panels (ADR 0025): while one
    is open, one poll per directory reads its change stamp and
    `GET /code/threads/:id/changes` pushes a version when it moves.
  - `code.webhook.ts`: the GitHub App's signed webhook (public).
  - `code.reviews.ts`: PR reviews (open, the assistant's first question,
    pending GitHub comments, submit, the PR's conversations, close), with `/code/reviews` routes in `code.projects.routes.ts`.
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
    `code_checkpoints`; `code_pr_events` (webhook deliveries, by id);
    `code_reviews` (PR reviews: the PR, its worktree and assistant).
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
