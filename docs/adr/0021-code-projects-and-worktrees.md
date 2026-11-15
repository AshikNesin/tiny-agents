# 0021 — Code projects: a repository on the sandbox, a worktree per thread

- Status: accepted (amends [0012](0012-claude-code-coding-mode.md) for project threads)
- Date: 2026-11-16
- Design: issue #297 (revision 3), phase 2

## Context

A Code thread had a `cwd` and nothing else: no repository, no branch, no
base to compare with, and two Claude Code threads in one directory edited
the same files (ADR 0012 left worktrees for later). Taking a task to a
merged pull request, Hoplite-, Amp- and T3-Code-style, needs a binding from
a thread to a repository and a branch of its own.

## Decision

- **A project** (`code_projects`) is one GitHub repository, its base
  branch, a clone on the sandbox under `~/tiny-agents-code/<owner>--<name>/`,
  a default harness and model, scripts and the Auto-fix rules. Creating one
  checks that the sandbox has `git` (and `gh` unless a token is set, ADR 0022) and that the credential reaches the repository, then clones it.
- **A thread started in a project gets its own worktree** on a new branch
  `ta/<slug>-<6 hex>`, cut from the freshly fetched base branch (or on an
  existing branch, such as a PR's head). The app passes the worktree as the
  thread's `cwd`, so this works for every harness whose `cwd` is on the
  sandbox without a driver change. `code_threads` gains `project_id`,
  `branch`, `base_sha` and `worktree`.
- **The agent commits; the app publishes** (ADR 0022). The first message
  starts with a short project line telling the agent its branch and not to
  push.
- **Scripts** come from a checked-in `.tiny-agents/code.json` (`setup`,
  `check`, `archive`) with a per-project override. `setup` runs before the
  first turn and after unarchive (a failure is reported to the agent; the
  turn still starts); `check` is what the agent is told to run; `archive`
  runs before a worktree is removed.
- **Lifecycle.** Archive runs `archive` and removes the worktree; the
  branch and the transcript stay. Unarchive recreates it from the branch and
  runs `setup`. Delete removes the worktree. A merged PR archives its thread
  when the project's "Archive on merge" is on (the default).
- **Review** for a project thread compares with the merge base of the base
  branch, served by the app's workspace module over the Sandbox connection,
  for every harness. Viewed marks are per thread, path and content hash
  (`code_review_viewed`); line comments are drafts (`code_review_drafts`)
  sent to the agent as one message.

## Consequences

- Threads without a project behave exactly as before; Shelley keeps its own
  worktree capability.
- One sandbox, many worktrees: each holds its own installed dependencies.
  Archive on merge keeps merged work from piling up.
- Every git command runs as the one sandbox user; the boundary is the
  sandbox, not the worktree (ADR 0012).

## Alternatives considered

- A sandbox per thread (Hoplite, Amp): best isolation, most of their
  infrastructure. Out of scope.
- Matching existing threads to projects by git remote: later.
