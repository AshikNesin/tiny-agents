# 0023 — Auto-fix: a pure decision, claimed passes, explicit trust and limits

- Status: accepted
- Date: 2026-11-16
- Design: issue #297 (revision 3), phase 5, open questions 5 and 7

## Context

A pull request's failing checks, review feedback and merge conflicts can be
fixed while the owner is away, as Hoplite's PR Auto-fix does. Unattended
work on other people's text needs rules that cannot drift.

## Decision

- **One path.** Every reconcile is `snapshot → decide(snapshot, loop,
  passes, settings, now) → act`. `decide` (`code.autofix.ts`) is pure and
  table-tested; nothing is read from an event payload.
- **Triggers:** a failed check on the head sha; a trusted
  `CHANGES_REQUESTED` or non-empty `COMMENTED` review; an unresolved thread
  whose latest comment is trusted; a merge conflict (3 attempts). Approvals,
  pending and stalled checks never start a pass; mergeability GitHub has not
  computed decides nothing.
- **Trust:** the owner's GitHub login, `OWNER`, `MEMBER` and `COLLABORATOR`,
  and allowlisted review bots. Everything else is shown, labelled Ignored.
  Every comment the app posts carries a hidden marker and its id is
  recorded, so it never starts a pass even when posted as the owner. PRs
  from forks are never fixed.
- **A pass** reuses the hand-off pattern: a `code_autofix_passes` row
  claimed (`starting`) before the harness hears anything, keyed by a hash of
  the head sha and the item ids; the worktree synced to the remote head; the
  fix request queued behind any running turn, with the untrusted material in
  one marked block and fixed instructions; the finish read on `turn_ended`
  (or swept up by the next reconcile).
- **The finish:** no new commit, a protected path, or a rejected push moves
  the loop to `needs_input`; otherwise the app pushes, replies to each fixed
  thread with the commit and resolves it. Without a parseable report block
  it posts one summary comment and resolves nothing.
- **Limits:** a 60 s quiet period; 6 passes in an hour pauses until a human
  pushes, reviews or writes; 10 passes in a row without the owner switches
  Auto-fix off; a pass past 20 minutes is interrupted. All but the quiet
  period are per project.
- **Permissions (question 5).** A pass is not a turn the owner started, so
  it never runs under YOLO's trust. It runs in the thread's own permission
  mode; anything the harness asks waits for the owner, and the pass times
  out into `needs_input`.
- **Both status columns are machines** (`autofix.ts`, `autofix-pass.ts`),
  written by compare-and-set.

## Consequences

- The Shelley and Claude Code harnesses report per item through a fenced
  `autofix-report` block, which can be missing; the app degrades to one
  summary comment rather than guessing.
- A skipped test inside the repository's own files is still possible; it is
  caught by review, not by the app.
- Not built yet: auto-merge, a final check when green, merge-queue
  handling, re-running a flaky check first, a per-thread spend limit, and
  the native harness's structured `autofix_report` tool.
