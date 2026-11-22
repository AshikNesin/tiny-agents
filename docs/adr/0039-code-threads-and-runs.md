# ADR 0039: Code threads own their id, belong to a project, and record runs

- Status: **accepted** (builds on [0011](0011-code-harness-adapters.md), [0020](0020-native-code-harness.md), [0021](0021-code-projects-and-worktrees.md), [0023](0023-auto-fix.md), [0024](0024-code-github-app-and-checkpoints.md))
- Date: 2026-11-22

## Context

The Code page grew one feature at a time: a thread list, a review panel, a
review page, a Reviews screen, a threads screen, a usage popover. The owner
used it daily and named the cost: too many clicks for each action. The
rebuild set one goal, a minimal keyboard-first workspace for coding in the
cloud, and four jobs to make fast: code with an agent in a thread, review
pull requests, steer a running agent, and run workflows that report back.
A screen that served none of the four was removed.

Under the old page a thread was addressed by its harness
(`<instance>:<native id>`), could live in any directory, and its state
(working, needs you, in review) was pieced together in the client from
several stores. Editing an earlier turn was not possible. The rebuild needed
a model where one row is the thread, whatever the harness does underneath.

## Decision

**A thread owns its id.** `code_threads` holds every thread under an id the
app makes. The harness address (instance and native id) is a column pair
with a unique index, not the identity. `threadRef` and `threadKey` in
`apps/web/src/server/api/code/code.threads.ts` are the only translation
between the two, and they still accept the composite form, so links and
hand-offs from before keep working. This is what lets a thread point at a
different harness conversation later (rewind, below) and keep its branch,
pull request, runs and URL (`/code/t/<id>`).

**Every thread belongs to a project.** A new thread, from the owner or from
a bot, starts through `startProjectThread`: one sandbox VM, the project's
clone, and a worktree and branch per thread (ADR 0021). There is no way to
start a thread in a bare directory. The Changes, Files, Pull request and
terminal features all read that worktree, so they work the same for every
harness.

**Runs record who started a turn.** `code_runs` (`code.runs.ts`) has one row
per turn that was started, with a trigger: `owner`, `workflow` or `bot`. A
workflow run names its workflow (Fix CI, Address comments, Resolve
conflicts, Fix issue, Review PR). A run's status is a typed machine
(`apps/web/src/shared/machines/run.ts`). The hub closes a run when the
harness reports the turn ended, so the bookkeeping does not depend on a
browser being open.

**Status is derived, not stored.** `threadStatus` in
`apps/web/src/shared/code-status.ts` works a thread's group (needs you,
working, in review, done) and its reason out of facts: whether it works,
whether the agent asks, whether the owner has read the last turn, the last
run, and the pull request's loop. The list, the keys that move through it
and the notifications read the same function. Nothing writes a status
column, so it cannot go stale.

**Edit and retry are a rewind.** To change an earlier turn
(`code.rewind.ts`) the app restores the worktree to the checkpoint taken
before that turn (ADR 0024), asks the harness to fork the conversation
before that message (`forkBefore`, behind the `threads.rewind` capability),
and repoints the thread at the fork. The conversation as it was stays as an
archived thread, and the files it replaces are checkpointed first, so Undo
can put both back. The thread keeps its id.

**A PR review stays its own entity.** A review of a pull request is a
`code_reviews` row with its own worktree and an assistant thread, and the
agent's review writes `code_findings`. It is not a `code_threads` row. It
shows in the thread list as a row under Reviews and opens on its own
full-screen page. Nothing is posted to GitHub until the owner submits.

**One key per action.** Plain letters act in the app; Shift letters post to
GitHub (publish, merge, approve, request changes). The commands are data
(`commands` in `Workspace.tsx` and `PullReview.tsx`), so the key list and
the command palette cannot drift from the keys.

**Owner-only.** Guests no longer reach Code (`GUEST_ACCESS` in
`apps/web/src/shared/guest-access.ts` lists none of it). A thread runs
commands on the owner's sandbox with the owner's GitHub credential, and the
earlier guest restrictions could not make that safe.

## Consequences

- One row answers "what is this thread": its project, branch, worktree,
  harness address, runs and pull request hang off one id.
- Bots start threads the same way the owner does. `code_start` takes a
  `project`, not a directory, and its thread gets a branch and a `bot` run.
- A harness needs no status logic of its own. It reports turn ends and
  capabilities; the app does the rest.
- Removed with the old page: the threads screen, the Reviews screen and its
  filters, the review page, non-project threads, guest access, the final
  check, the merge-queue trigger, the spend limit, auto-merge, the
  next-prompt suggestion, the usage report and bulk select.

## Known deviations

- `code_autofix_passes` is kept beside `code_runs`. A pass is claimed for
  one state of a PR before the harness hears anything (ADR 0023), which a
  run does not model. A pass that starts also records a `workflow` run.
- Shelley and Claude Code cannot rewind: neither can fork a conversation
  before a message, so their threads do not offer edit or retry.
- A review is not a thread, so the list's `j` and `k` do not walk review
  rows.
- The agent does not start a review on its own when one is requested.
