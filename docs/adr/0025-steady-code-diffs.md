# ADR 0025: Steady diffs: one git reader, plumbing reads, pushed change versions

- Status: **accepted** (amends [0021](0021-code-projects-and-worktrees.md), [0024](0024-code-github-app-and-checkpoints.md))
- Date: 2026-11-16

## Context

The Code page's Changes and Review panels glitched while an agent worked,
most visibly on the local sandbox container reached over SSH:

- Two git readers had drifted. The worker's (Changes) used `-z` and listed
  untracked files; the app's (Review, over SSH) did neither, so an agent's
  new file was missing, a rename read as 0/0 (`--numstat` saw a rename,
  `--name-status --no-renames` did not), and one non-ASCII path failed the
  whole panel (git C-quoted it, then `hash-object` could not find it).
- Porcelain `git diff <commit>` refreshes the index even under
  `--no-optional-locks` (verified on git 2.43), so a panel's read could hold
  `index.lock` exactly when the agent committed.
- A side that was binary, over the size cap or unreadable came back as `""`,
  which the panel drew as a whole-file addition or deletion.
- Every transcript row bumped the panels' refresh key: the Changes panel
  swapped its list for a spinner (folds and scroll lost), and its trailing
  1.5 s debounce never fired while the agent kept writing.
- History from `getSessionMessages` drops each tool's `structuredPatch`, so
  an Edit's diff changed shape (real hunks live, an `@@ -1,n` rebuild from
  the input after a reload).

We read how Orca (stablyai/orca) runs remote worktrees: a daemon next to
the files runs one git and diff implementation, reads with
`GIT_OPTIONAL_LOCKS=0`, returns both full sides with explicit binary and
too-large flags, pushes file-change signals on a fixed batching cadence
("a trailing debounce stalls under continuous agent writes"), and drops
stale replies by generation.

## Decision

- **One reader.** `packages/claude-worker/src/git-reads.ts` lists changes,
  reads both sides and makes a change stamp over a small port (`git` with an
  argument list, file size, file read, file stats). The worker runs it with
  `execFile` and `fs`; the app's project workspace runs the same module over
  the sandbox exec port.
- **Plumbing reads.** Listings use `diff-index` / `diff-tree -r` (never
  porcelain `diff`), `--no-optional-locks`, `-z`, `core.quotePath=false`
  and `--no-renames`. `--numstat` (which compares content) decides which
  files changed; `--name-status` only gives the letter, because without an
  index refresh it reports a touched-but-unchanged file as modified.
  Untracked, non-ignored files count as added, their lines from one
  `git grep --untracked -c`.
- **Sides say why.** A side over 2 MB or with a NUL in its first 8000 bytes
  makes the file `unshowable: "binary" | "tooLarge"` with both contents
  empty. The client also caps a drawn diff at 4,000 lines and gives jsdiff a
  1.5 s timeout.
- **Pushed versions.** `GET /code/threads/:id/changes` streams
  `{ type: "changes", version }` while a panel is open. The server
  (`code.changes.ts`, one poll per directory) reads the change stamp: HEAD,
  `git status --porcelain=v2 -z`, and each changed path's size and
  nanosecond mtime, every 1.5 s, 5 s after a quiet minute, never two at
  once, stopped with the last panel. A project thread stamps its worktree
  over SSH; any other thread asks its harness (`changeStamp`, the worker's
  `git_stamp` op). It says `unavailable` once when it cannot read, and the
  panels then re-read on transcript activity as before.
- **Steady panels.** Panels follow their key on a fixed 750 ms beat (not a
  debounce), keep the previous list and diff on screen while re-reading,
  and key the open diff by file and content hash.
- **History patches.** The worker's `coding.history` reads the session's
  JSONL for `toolUseResult.structuredPatch` and puts it back on the matching
  entries (best effort; the original file's content is dropped).

## Consequences

- One place to fix git parsing; the conformance comes from tests on real
  git for both the worker op and the SSH workspace.
- An open panel costs one `git status` and one `stat` batch on the sandbox
  every 1.5 to 5 seconds per directory, nothing while closed. A third SSE
  per visible tab while a panel is open (hidden tabs give theirs back).
- A worker that predates `git_stamp` answers an error; the stream says
  `unavailable` and the panel falls back until the worker updates.
- The stamp uses file times, so a write that keeps size and lands in the
  same nanosecond is missed until the next change; a `touch` of a changed
  file is a spurious (harmless) re-read.
- The Android Changes screen gets empty sides for binary or large files
  (no garbage), but does not yet say why.

## Alternatives considered

- **A filesystem watcher on the sandbox** (Orca's `@parcel/watcher`):
  needs a native module or inotify tools on every sandbox, and recursive
  watches over `node_modules` exhaust inotify limits. Git's own status
  already respects `.gitignore`; polling it only while a panel is open is
  cheap enough.
- **Keep the debounce, just stop blanking the list:** the panel would still
  sit stale for as long as the agent writes without a 1.5 s pause.
- **Porcelain `git diff` with `GIT_OPTIONAL_LOCKS=0`:** it still rewrites
  the index on git 2.43.
