# Code workspace rebuild: plan

Status: for the owner's approval. Implements [`SPEC.md`](./SPEC.md). No
feature code exists yet.

## What the code says

Read on 22 November 2026.

- **Size.** The server layer is 23 files in `apps/web/src/server/api/code`,
  the client is about 12,000 lines under `apps/web/src/client/pages/code`,
  and about 13,000 lines of tests cover them.
- **A thread has no id of its own.** Its key is the harness instance and the
  harness's native id joined (`packages/code/src/contracts/ids.ts`). A fork
  therefore makes a different thread that has lost its project, branch and
  worktree. Edit and retry need the opposite, so the thread gets its own id.
- **A review is a second kind of thing.** `code.reviews.ts` keeps its own
  entity, worktree and assistant thread, and comments on it are keyed by a
  pseudo thread id. The spec folds it into the thread.
- **Much of the logic is already independent of the model** and stays:
  `code.workspace.ts` (git on the sandbox), the pure Auto-fix decision,
  `code.github.ts` and its three transports, `code.webhook.ts`,
  `code.checks.ts`, `code.naming.ts`, the reconcile job chain in
  `code.pulls.ts`.
- **The renderers are sound; the navigation around them is the problem.**
  `Transcript.tsx`, `UnifiedDiff.tsx`, `DiffWorkspace.tsx`, `LightEditor.tsx`
  and the terminal view are driven by props. `CodePage.tsx` and its panels,
  screens and sidebars encode the old layout. They are replaced.
- **Keys are ad hoc today.** Code registers three shortcuts by hand, while
  `packages/ui/src/hotkeys.ts` already has a registry that ignores single
  letters while typing. The new workspace uses it for everything.
- **Clicks today, from an open thread:** publish a pull request 2 to 3, Fix
  CI 2 to 3, a terminal in the worktree 4 or more (there is no such action),
  approve someone's pull request 5, edit an earlier turn not possible.
- **The native harness is feasible on what exists.** `AgentRuntime` already
  has create, submit with steer or follow-up, abort, withdraw, watch and
  approvals. It lacks fork, compact and a working directory, all of which
  pi-durable provides. The coding tools are built on the toolkit model the
  sandbox toolkit uses, because the Tool gate only wraps toolkit tools.
- **This environment can run all of it.** The app boots here on the faux
  model with the fake GitHub. A spike showed the real Terminal page running
  a live tmux shell through a 70-line local SSH server, with no Docker. No
  coding agent runs here today, since Shelley's binary is unavailable; the
  native harness on the faux model fills that gap.

## Information architecture

Three routes: the workspace, a thread in it, and settings. Everything else
is a pane or a key.

| Route                    | Shows                                         |
| ------------------------ | --------------------------------------------- |
| `/code`                  | the workspace with no thread open             |
| `/code/t/<thread>`       | a thread; the pane and drawer ride in a query |
| `/code/settings`         | projects, the GitHub credential, workflows    |
| `/code/review?pr=<link>` | opens, or makes, that pull request's thread   |

Focus sits in one of three columns. A key acts on the focused column and
never depends on a mode; an action that posts to GitHub is a Shift letter.

| Key         | Action                                       |
| ----------- | -------------------------------------------- |
| `h` `l`     | focus the column to the left or right        |
| `j` `k`     | next or previous in the focused column       |
| `u`         | jump to the next thread that needs you       |
| `n`         | new thread                                   |
| `c`         | focus the composer                           |
| `Esc`       | stop the agent, or leave the field           |
| `1` `2` `3` | pane: Changes, Pull request, Files           |
| `` ` ``     | terminal drawer                              |
| `[` `\`     | hide the list, hide the pane                 |
| `e` `t`     | edit, or retry, the focused turn             |
| `f` `a`     | run Fix CI, run Address comments             |
| `r`         | ask the agent to review                      |
| `n` `p`     | next or previous finding, in a review thread |
| `y` `d`     | add the finding to my review, dismiss it     |
| `v`         | mark the file viewed                         |
| `P` `M`     | publish the pull request, merge it           |
| `A` `X`     | approve, request changes                     |
| `⌘K` `?`    | every command, the key list                  |

`n` opens a new thread from the list and steps findings inside a review
thread's pane, and `e` edits whatever is focused, a turn or a finding. The
focused column decides, as it does for `j` and `k`.

### Wireframes

A work thread, the default split:

```
+-- Code ------------ n +-- acme/web / Fix Google sign-in   ta/fix-cb  #212 x +-- Changes 1 | PR 2 | Files 3 ----+
| NEEDS YOU             |                                                     | Branch vs main | Last turn       |
| * Fix Google sign-in  |          The callback 500s when the state cookie    | auth/google.ts          +14 -3   |
| * #208 rate limiter   |          is missing. Fix it and add a test.         |  41   const state = ...         |
| WORKING               | > Worked 42s: 3 commands, 2 files                   |  42 - if (state !== ...) throw   |
| o Address comments    | The callback now returns 400 ...                    |  42 + if (!state) return ...     |
| o Export invoices     | -- Fix CI, started by check `test` -- running ----- |     [you: return 400 here too]  |
| IN REVIEW             | $ pnpm test auth                                    | tests/google-callback.test +31  |
| . Dark mode tokens    |   x state cookie is cleared ...                     |                                 |
| DONE                  |            (queued) Also update the changelog       |                                 |
| . Bump vitest         +-- terminal: ~/acme--web/ta-fix-cb ---------------- `+                                 |
|                       | $ pnpm test auth                                    |                                 |
|                       +-----------------------------------------------------+                                 |
|                       | [ Message the agent                               ] |                                 |
|                       | Enter steer . Alt+Enter queue . Esc stop            |                                 |
+-----------------------+-----------------------------------------------------+---------------------------------+
```

A review thread, the same columns split for reading, the list hidden:

```
+-- acme/web / #208 Add rate limiter ----+-- Changes 1 | PR 2 | Files 3 ---- 1/4 viewed . 2 pending  [A] [X] --+
| priya . 4 checks pass                  | files            | auth/limiter.ts                    +17  viewed v |
| BRIEF                                  | . limiter.ts   2 |   8 + const key = c.req.header(...)              |
| Adds an in-memory limiter on POST      | . login.ts     1 |   +- Agent . bug: anyone can dodge the limit --+  |
| /login. Tests: 13 passed.              | . limiter.test 1 |   | The key is the raw header ...              |  |
| Read: limiter.ts, login.ts, the test   | v pnpm-lock      |   | [Add to my review y] [Edit e] [Dismiss d]  |  |
| FINDINGS . 4 open                      |                  |   +--------------------------------------------+  |
| bug  dodge the limit      limiter:8    |                  |  11 + if (now - hit.start > WINDOW_MS) ...       |
| bug  window never resets  limiter:11   |                  |   +- You . pending ----------------------------+  |
| test no reset test        test:5       |                  |   | Reset start here as well.                  |  |
| nit  5 is hard-coded      login:15     |                  |   +--------------------------------------------+  |
+----------------------------------------+                  |                                                  |
| [ Ask about this pull request        ] |                  |                                                  |
+----------------------------------------+------------------+--------------------------------------------------+
```

New thread, one dialog on `n`:

```
+-- New thread -------------------------------------------+
| acme/web v    native v    sonnet v    Bypass v          |
| [ What should the agent do?                           ] |
| Paste a pull request link to review it, or an issue     |
| link to fix it.                              Enter start |
+---------------------------------------------------------+
```

Settings is one page of three sections: Projects (a row each, opening its
branch, scripts and workflow settings), GitHub, and Workflows (the five
prompts and the unattended-loop defaults).

## Data model

One new migration, generated by `pnpm db:generate`. Applied migrations are
not edited.

| Table                                                                                                                                     | Change                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code_threads`                                                                                                                            | The id becomes the thread's own; existing ids stay valid as opaque strings. Gains a kind (work or review) and a stored status with its reason. Loses the follow flag and spend limit. Rows without a project are deleted. |
| `code_runs`                                                                                                                               | New. One row per turn: its trigger (owner, a workflow and its event, a bot), a guarded status, the checkpoint before it, its report. Replaces `code_autofix_passes`.                                                      |
| `code_findings`                                                                                                                           | New. What a Review PR run reported: severity, title, body, file and line, and whether the owner added or dismissed it.                                                                                                    |
| `code_review_drafts`                                                                                                                      | Becomes the one comment table, keyed by thread: target (agent or GitHub), sent or pending, and the finding it came from.                                                                                                  |
| `code_pull_requests`                                                                                                                      | Kept. Gains the owner's role (author or reviewer) and the commit of the owner's last review.                                                                                                                              |
| `code_inbox`                                                                                                                              | New. A cache of pull requests waiting for the owner's review that have no thread yet.                                                                                                                                     |
| `code_reviews`                                                                                                                            | Dropped. A review with an assistant becomes that thread; one without is found again through the inbox.                                                                                                                    |
| `code_checkpoints`, `code_review_viewed`, `code_projects`, `code_pr_comments`, `code_pr_events`, `code_handoffs`, `code_handoff_finishes` | Kept. Project settings gain the workflow prompts and switches.                                                                                                                                                            |

The status of a thread is one pure function of facts the server already
has: whether the agent is working, an open approval, the last run's
outcome, the pull request snapshot and the loop state. It is recomputed
when a fact changes and stored, so the list is one query. The run status,
like the hand-off and loop statuses today, is a typed machine with guarded
writes.

## Key components

**Server**, in `apps/web/src/server/api/code`:

- Threads: create a work or review thread, the list, status, archive, and
  rewind. Rewind restores the checkpoint, forks the harness conversation at
  that message, and points the same thread at the fork.
- Runs: start, finish and label a turn; take the checkpoint at its edges.
- Streams: one list stream of summaries and one stream per open thread.
- Workflows: the five definitions (trigger, prompt, limits) around the
  existing pure decision, each run a row in `code_runs`.
- Review: findings from a report block the agent ends its run with, the
  owner's pending comments, submit, and re-review.
- Files: tree, read, guarded write and search in a worktree.
- Kept and trimmed: workspace, projects, GitHub, webhook, checks, naming,
  the pull request reconcile chain, the bot hand-off.
- One router with resource-shaped routes under a thread.

**Client**, replacing `apps/web/src/client/pages/code`:

- The workspace shell: three columns, focus, resizing, the route.
- A key map in one file, registered through the existing hotkey registry,
  which also feeds the command palette and the `?` list.
- Thread list, thread (transcript, runs, queued messages, composer), new
  thread dialog.
- Panes: Changes, Pull request, Files; the terminal drawer; the review
  column (brief, findings).
- Reused as they are: the transcript rows, the diff and tree renderers, the
  light editor, the terminal view.

**Packages:**

- `packages/code`: a third driver for the native harness, and the fork
  semantics rewind needs stated in the contract and its conformance tests.
- `packages/agent`: a working directory, fork, compact and remove on
  `AgentRuntime`, and the coding toolkit (read, write, edit, bash, find)
  scoped to the thread's worktree and run through the Tool gate.
- `packages/sandbox`: a terminal session that starts in a directory.

## Migration path

Each step is one or more commits, leaves the app working, and deletes what
it replaces. Old screens stay reachable only until their step lands.

1. **Tools to run it here.** A local sandbox script (the spike, plus resize
   and file transfer), coding commands for the faux model, and a launch
   option in the verify helper.
2. **Visible slice.** The new shell at `/code`: status-grouped list, thread,
   composer, Changes pane, the key map and palette, on today's API. Deletes
   the old page, list, screens and panels it replaces. First preview.
3. **Thread core.** Thread ids of their own, the stored status, runs, the
   new routes and streams. Code becomes owner-only. Threads outside a
   project go. The new-thread dialog.
4. **Native harness.** Runtime additions, coding toolkit, driver, the four
   permission modes, a default-model role, the conformance tests. Becomes
   the default once they pass.
5. **Steering.** Queue edit, send now and cancel; the two stops; tool rows;
   edit and retry by rewind, with Undo.
6. **Files and terminal.** The Files pane, search, the editor, the terminal
   drawer in the worktree, last-turn scope and comments in Changes.
7. **Pull request.** Publish, checks, comments, merge and their keys.
8. **Workflows.** Fix CI, Address comments, Resolve conflicts and Fix issue
   as runs; the unattended loop; the four cuts.
9. **Review.** Inbox rows, review threads, Review PR with brief and
   findings, comments to a review, submit, re-review. Deletes the review
   entity and its screens.
10. **Edges.** One settings page, the bot tools, the phone column,
    notifications.
11. **Close out.** Delete leftovers, write the ADRs (0020 for the native
    harness, one for the thread model) and the feature doc, rewrite the
    verify journeys, delete this folder.

The owner previews on the real sandbox and GitHub after steps 2, 4 and 9.

## Verification

- **Server tests** per job against the in-memory harness, the fake GitHub
  and real git in a temporary home: start a thread, steer and queue and
  stop, rewind, publish, a workflow run from a failed check to a push, a
  review from inbox to submit.
- **Client tests** for the flows a key drives, with a fake thread stream:
  each test fails if the key stops doing its job.
- **Journeys in the running app** here, on the native harness with the faux
  model, the local sandbox and the fake GitHub: one per job, with
  screenshots, then a stress pass (many threads, rapid steer and stop, a
  dropped stream mid-turn, a 200-file diff).
- `pnpm verify` green at every step that is pushed.

## Risks and gaps

- **Size.** Eleven steps over a feature this large. The order puts a usable
  workspace first, so stopping early still leaves something coherent.
- **Shelley and Claude Code are not run live here.** Their drivers keep
  their wire-format tests; the owner's previews cover the real thing.
- **Rewind depends on each harness's fork.** The contract test pins it; a
  harness that cannot fork at a message offers no Edit.
- **Android's Code screens break at step 3** and stay broken.
- **The local sandbox is not the VM.** It proves the app's side of the
  wire, not the VM's setup.
