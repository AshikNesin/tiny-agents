# 0024 — The GitHub App transport, auto-merge, checkpoints and the rest of phase 6

- Status: accepted (amends [0021](0021-code-projects-and-worktrees.md),
  [0022](0022-github-through-gh-or-a-token.md) and [0023](0023-auto-fix.md))
- Date: 2026-11-16
- Design: issue #297 (revision 3), §6, §7.4, §8, §9.4, §9.6 and phase 6

## Context

ADRs 0021 to 0023 shipped the PR loop on `gh` or a token, with polling.
They left out the GitHub App transport and webhooks, auto-merge, a final
check when green, merge-queue handling, per-turn checkpoints, the per-thread
spend limit and the `Thread-Id` trailer.

## Decision

- **The App transport** is a project's choice (`transport: app`). The App's
  id is a setting; its private key and webhook secret are `app` vault items
  for the `github` sink. `packages/github` mints the app JWT and trades it for
  installation tokens (cached until a minute before expiry, in the App root);
  the RS256 signature is the app server's, so the key never enters the
  package. Installation tokens serve API calls and the sandbox's `git push`
  alike. Under the App, comments are the App bot's, so the owner's login is
  not used for trust.
- **Webhooks are hints.** One public route, `POST /api/v1/code/github/webhook`,
  refuses anything not signed with the secret (HMAC-SHA256, compared in
  constant time), stores the delivery id (unique: a redelivery is dropped)
  and brings the reconcile of the linked PRs it names forward to 5 seconds.
  Nothing in the payload is acted on; the reconciler reads a fresh snapshot
  as always, and the delayed chain stays the backup.
- **Auto-merge** is a per-PR switch, off by default (a project can default
  it on). With it on and no pass running, the app turns on GitHub's native
  auto-merge (marking a draft ready first), so branch protection and
  required reviews stay GitHub's to enforce. Switching it off also turns
  GitHub's off, and stays off.
- **A final check when green** (a project setting, off by default): when the
  PR would go green, one pass asks the agent to review the whole change once
  more. A final check that makes no commit ends `clean` and the PR settles
  green; one that commits is pushed under the usual rules.
- **Removed from the merge queue** is a trigger (on by default): the latest
  `RemovedFromMergeQueueEvent`, while the PR is not back in the queue.
- **The spend limit** is per thread, as in Hoplite, where the harness
  reports cost: once the thread's cost reaches it, a pass that would start
  pauses the loop instead. Each pass records what it cost.
- **Checkpoints.** At a project thread's start and at each turn end that
  changed something, the worktree (uncommitted and new files included) is
  committed with a temporary index under a hidden ref
  (`refs/tiny-agents/checkpoints/<branch>/<seq>`), leaving the worktree, its
  index and its branch alone. Changes shows what any one turn changed.
  **Revert to here** first checkpoints the current state, then puts the
  files back as uncommitted changes on top of the branch: history, and
  anything pushed, is never rewritten. It is refused while the agent works.
- **The `Thread-Id` trailer.** Each project worktree gets its own hooks
  directory (per-worktree config, as `git sparse-checkout` sets it up): its
  `commit-msg` adds `Thread-Id: <thread id>` and every hook then runs the
  repository's own hook of that name, so the repository's hooks still run.
  The app's own push keeps hooks off.

## Consequences

- The trailer is installed once the harness has named the thread, so a
  commit made in the first instant of the first turn can miss it.
- Checkpoint refs stay in the project's clone until it is removed.
- Not built: re-running a flaky check before spending a pass, mention
  commands from PR comments, threads started from issues, a preview script,
  matching Shelley threads to projects by remote, and the native harness.
