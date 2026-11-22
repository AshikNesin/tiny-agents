# Code workspace rebuild: spec

Status: decisions from the owner interview of 22 November 2026. No plan and
no feature code exist yet. This folder is working material for the rebuild:
when the build is done its decisions move into ADRs and
[`docs/features/code.md`](../features/code.md), and the folder is deleted.

## Goal

One minimal coding workspace the owner uses every day to code in the cloud.
It makes four jobs fast, and the owner's complaint about today's Code page,
too many clicks per action, is the measure of success.

1. Code with an AI agent in a thread.
2. Read and review pull requests: diffs, comments, CI, approve or request
   changes.
3. Steer a running agent: interrupt, redirect, queue, edit or retry a turn,
   and see exactly what it did.
4. Run workflows in the background ("fix this bug", "address review
   comments", "fix failing CI") that report back.

A screen that serves none of the four is removed.

## Scope and depth

- Everything from the HTTP API up is rebuilt: routes, orchestration and the
  whole client. When the new path works the old one is deleted.
- Kept and trimmed underneath: the harness contract and drivers in
  `packages/code`, the git reader in `packages/git`, the GitHub client in
  `packages/github`, and the terminal service in
  `packages/sandbox/src/terminal`.
- The standalone Terminal page is a sandbox feature, not part of Code, and
  stays. The workspace reuses its service.
- Android's Code screens are rebuilt later. They break when the API changes.
- Code becomes owner-only. Guest access to it is removed.
- Bots keep a way to start and follow a coding thread; their tools are
  rebuilt on the new model.

## Agents

- Three harnesses behind the one contract: Shelley, Claude Code, and a new
  native harness on pi-durable, designed in
  [issue 297, section 5](https://github.com/AshikNesin/tiny-agents/issues/297).
- The native harness is the default for new threads once it passes the
  shared harness scenarios. The agent is a chip in the composer, remembered
  per project.
- Code runs on the one sandbox VM. Each thread has its own git worktree and
  branch. The agent commits; the app pushes, never forced.

## Model

- **Project**: one GitHub repository, cloned once on the sandbox.
- **Thread**: belongs to a project and owns one worktree and branch, at most
  one open pull request, and its runs. A work thread starts on a new branch
  from the base. A review thread starts on an existing pull request's head.
  There are no threads outside a project.
- **Run**: one turn of the agent. It records what started it: the owner, a
  named workflow and its event, or a bot.
- **Workflow**: a prompt, a trigger and limits.
- **Status**, derived, never set by hand: Needs you, Working, In review,
  Done. Needs you covers an open approval or question, a failed turn, a
  failing check or unanswered review comment with the unattended loop off, a
  loop that stopped itself, a pull request waiting for the owner's review,
  and one its author pushed to since that review.

## Workspace

- **Layout**: three columns. The thread list, the thread, and a work pane
  that shows one of Changes, Pull request or Files at a time. The terminal
  is a drawer under the thread, opened in the thread's worktree.
- **Thread list**: one list grouped by status. A pull request that asks for
  the owner's review is a row under Needs you; opening it makes its review
  thread. There is no separate Reviews screen, inbox or Threads screen.
- **Keys**: single-letter keys whenever the owner is not typing, and a
  command palette listing every action. Every primary action is one key from
  anywhere in a thread and none sits in a menu. Keys are fixed in this
  version.
- **Composer**: Enter sends, and steers while the agent works. Alt+Enter
  queues for the end of the turn. Escape stops. A queued message can be
  edited, sent now or cancelled.
- **Transcript**: a finished turn folds its work behind one line. A tool
  call is one summary line that opens to its detail; a running command shows
  a live tail; a diff shows without a click.
- **Edit and retry**: Edit rewinds. Files go back to their state before that
  turn, and the conversation continues from that message with the new text
  in the same worktree. The replaced continuation is kept as an archived
  thread, with Undo. Retry does the same with the original text. Per-turn
  checkpoints are kept for this.
- **Changes**: the branch against its base, or the last turn alone. A line
  comment goes to the agent with the next message.
- **Pull request**: checks with the failing log excerpt, comments, and the
  actions Fix CI, Address comments, Merge and the unattended-loop switch.
- **Review thread**: the same three columns, split for reading: the diff
  wide, the agent narrow, the thread list hidden until asked for. The agent
  prepares and the owner decides. It writes a short brief, runs the tests in
  the pull request's checkout, suggests a reading order, and lists findings
  by severity, each shown under the line it is about. One key steps through
  findings, one adds a finding to the owner's review as a comment, one edits
  it first, one dismisses it. A line comment of the owner's goes to the
  review by default, and to the agent with a modifier. Approve and Request
  changes are one key each and open a summary the agent drafted from the
  pending comments, for the owner to edit.
- **Who speaks on GitHub**: only the owner. The agent never posts a review
  or comment on its own; nothing reaches GitHub until the owner submits.
- **Re-review**: when the author pushes after the owner's review, the thread
  returns to Needs you and opens on what changed since that review, and the
  agent marks each earlier comment as addressed or not.
- **Files**: a file tree and open-by-name on the worktree, text search
  across it, and a light editor with syntax colors, find, and a save that is
  refused when the file changed since it was opened. Edits show in Changes
  like the agent's. No language server, completion, debugger or extensions.
- **Settings**: one page for projects, the GitHub credential and workflows.
- **Phone**: one column to read a thread, send and approve. No review.
- **Speed**: the list stream carries summaries only, one live stream serves
  the open thread, and a diff draws only what is in view.

## Workflows

- Five built in, no general builder: Fix CI, Address comments, Resolve
  conflicts, Fix issue (from a GitHub issue link or pasted text) and Review
  PR.
- Review PR runs on demand with one key. A per-project switch, off by
  default, runs it as soon as a pull request asks for the owner's review, so
  the brief and findings are ready when the thread is opened.
- A run is an ordinary turn in the thread, labelled with its trigger, so it
  can be watched and steered.
- Triggers: one key on a pull request, or the unattended loop, which is off
  by default per project.
- Reporting back: the thread moves to Needs you, with a push notification,
  and a pull request comment only when a run resolved review threads.
- Kept from Auto-fix: pull request text is untrusted, protected paths, pass
  limits, trust rules, and never force-pushing.
- Scheduled runs stay with routines and the bot hand-off.

## Removed

The final check when green, the merge-queue trigger, the spend limit and
auto-merge. The next-message suggestion. The detailed usage report (one
context and cost figure stays). Bulk select, grouping toggles, links by
thread title, change directory and Open in Shelley. "Post as suggestions". Threads outside a project leave the list and stay
in their agent's own storage.

GitHub stays reachable three ways, as today: a token, `gh`, or the GitHub
App with its webhooks. The owner uses the App on personal projects.

## Data

Projects, the GitHub credential, project threads, pull request links and
checkpoints carry over. Other Code tables may be dropped or reshaped by new
migrations.

## Verification

The build is verified here against the faux model, the test sandbox and the
fake GitHub the repository already has, by doing each of the four jobs in
the running app. This environment has no Docker, sandbox VM, Shelley,
Claude subscription or GitHub credential, so the owner smoke-tests against
the real sandbox and GitHub at milestones the plan names.

## Accepted by default, worth a second look

- The Android app's Code screens stay broken until their own follow-up.
