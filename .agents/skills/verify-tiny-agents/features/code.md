# Code

`/code` is the owner's workspace for coding agents. With Shelley configured the owner picks a working directory (validated by the harness), starts a thread, watches the reply, steers the running turn, queues follow-ups, stops a turn, renames the thread (and opens it by title at `/code/s/<title>`), reviews uncommitted changes, and finds threads in a sidebar grouped by project, then by repository or folder (working threads first in their group, unread dots, groups that fold, a New thread per group, search, and an `Archived` view in the footer beside `Settings`, where Projects and GitHub live). Bots hand coding tasks to the same agent from a chat and get the outcome back as a relayed reply.

## Sub-features

- `code-new` `/code` (`/code/new`): heading `What should we build?` (`What should we build in <project>?` with a project picked), composer `Message Shelley`, chips `Model` (`predictable`) and `Reasoning`; `Start`. No recent-threads list here any more.
- `code-cwd` `Working directory` picker: recent dirs, `Use “<path>”`, `Browse folders…`; a bad path shows an alert (`directory does not exist`); a git repo enables `New worktree`; the last directory is remembered.
- `code-turn` a thread page (`/code/shelley%3A<id>`) with transcript region `Messages`, `Worked for …` footer, live over `GET /api/v1/code/threads/:id/events` (SSE).
- `code-steer` while working, Enter steers (placeholder `Steer Shelley: goes into the running turn`).
- `code-queue` Alt+Enter queues; `code-queued` lists it with `Send now` / `Cancel queued message`.
- `code-stop` `Stop Shelley` → `[Operation cancelled]`.
- `code-rename` thread actions (`<title>: thread actions`) → `Rename` dialog; `/code/s/<title>` opens a thread by title.
- `code-changes` `Changes` panel (`code-changes`): one `code-file` card per changed file with its diff; `Close changes`.
- `code-list` navigation `Code threads`: one flat list, working threads first, then newest first; the footer's `Group by repository` (`aria-pressed`, remembered in the browser) switches to one region per group (`code-group`, a `<section>` named by its heading: a project's name, a repository's or folder's basename, or `No folder`); the heading is a button (`aria-expanded`) that folds the group; links `New thread in <label>` (`/code/new?project=<id>` or `/code/new?cwd=<path>`) and, for a project, `<label> settings`; a group shows 8 threads, then `Show N more`. Rows: `Working` status (working threads float to the top of their group), `Unread` dot, `Archive <title>`. The `Search threads` button opens the search box (`Search threads`); Escape closes it.
- `code-archived` footer button `Archived` (`code-archived-toggle`, `aria-pressed`) lists archived threads (no New thread links), row `Restore <title>`; `Archived threads` (`code-archived-back`) goes back.
- `code-settings` footer link `Settings` (`code-settings`) → `/code/settings`, which opens its `Projects` section (heading `Projects`, region `Add a project`, `Your projects`); navigation `Settings sections` with `Projects` / `GitHub`. A project's page and the GitHub credential/App section are not driven (they need GitHub).
- `code-shell` no top bar on `/code`: the sidebar's top row holds `Back to <brand>` and the ⌘K trigger.
- `code-handoff` a bot's `/code cwd=<dir> <task>` (faux trigger) starts a Shelley thread: hand-off card with `Open in Code`, then `Shelley reply relayed into this chat` with the outcome.
- Covered by [Code extras](./code-extras.md): change directory, fork, attachments, `@` file completion, `/` commands, skills, usage popover, new worktree, repository groups, chips, queued Send now/Cancel, recover. Not driven anywhere: delete and archive from the title menu (cleanup uses the API; the row's Archive is driven), the thread cost in that menu (`code-cost`, Shelley reports none), `Show N more`, Open in Shelley, subagents (`subagent:` prompts), push notifications (off in verify runs).
- Harness picker, Claude Code threads, permission chips and approval cards: need the Claude Code harness (see `claude-plan.md`); unreachable.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Code` (present only when a harness is configured); `Back to <brand>` at the top of the thread list returns.
- From a chat hand-off card: `Open in Code`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --shelley` (the journey requires `shelley`; add `--sandbox` for the full group pass). Shelley runs on the host with its keyless `predictable` model and its own DB under the run directory.
- Predictable prompts: `echo: X` → `X`; `delay: N` → works N s then `Delayed for N seconds`; `bash: CMD` runs CMD in the cwd then `Done.`; anything else → `edit predictable.go to add a response for that one...`. Probe with `curl --noproxy '*' http://127.0.0.1:<port+1000>/api/conversations/new -d '{"message":"…","cwd":"…","model":"predictable"}'`.

- **Setup.** `setup:` a throwaway git repo `data/verify/<run>/work-<stamp>` (one commit). Cleanups: delete every thread (active and archived) whose `cwd` is that dir, polling until none is listed; remove the dir.
- **Open.** Sidebar `Code` → composer visible, `Model` reads `predictable`, no `code-harness` picker.
- **Cwd.** `Working directory` → fill `/nonexistent-<stamp>` → Enter: `alert` `directory does not exist`. Again with the repo path: option `Use “<dir>”`, button reads `…/<run>/work-<stamp>`, `New worktree` enabled.
- **Start + steer + queue.** `delay: 12` → `Start`: URL `/code/shelley%3A…`, `Stop Shelley`, region `work-<stamp>` (the repo's group) with a `Working` status. Type `echo: steer-<stamp>` + Enter: the user bubble reads `delay: 12 echo: steer-<stamp>`. Wait 4 s, then `echo: queued-<stamp>` + Alt+Enter: `code-queued` shows it with its two buttons. After the turn: `Delayed for 12 seconds`, `steer-<stamp>`, `queued-<stamp>`, no queue, no `Working` status left in the group.
- **Stream.** Reload: a response for `/code/threads/<id>/events` has `content-type: text/event-stream`; `echo: hello-<stamp>` answers `hello-<stamp>`.
- **Stop.** `delay: 60`, `Stop Shelley`: `[Operation cancelled]`, `Send` back, API `working: false`.
- **Rename.** Thread actions → `Rename` → `verify-<stamp>`: `code-title` and the API agree; `/code/s/verify-<stamp>` opens the thread.
- **Changes.** `bash: echo changed-<stamp> > b.txt` → `Done.`; `Changes` → `code-file` for `b.txt` containing `changed-<stamp>`; `git status` in the dir agrees. `Close changes`.
- **Unread.** `New thread` (exact name; directory remembered) → `delay: 15` → `Start`; open the first thread from the list; the second row shows `Working`, then an `Unread` dot; API `unread: true`.
- **Group.** The group's heading button `work-<stamp>` (`aria-expanded` true) folds it: the rows go; again to unfold. `New thread in work-<stamp>` has href `/code/new?cwd=<encoded dir>` and opens `What should we build?` with `Working directory` reading `…/<run>/work-<stamp>`.
- **Search.** `Search threads` button, then the `Search threads` box = `verify-<stamp>`: only that row; Escape closes the box.
- **Archive.** Row `Archive verify-<stamp>`: gone from Active, in `?view=archived`; footer `Archived` (pressed) lists it, with no `New thread in …` links; `Restore verify-<stamp>`; `Archived threads` → back in Active.
- **Settings.** Footer `Settings` → the Projects section of `/code/settings` (URL ends `projects`), heading `Projects`, region `Add a project`, `Settings sections` with `Projects` current and `GitHub`; `Back to <brand>` in the list.
- **Hand-off.** `setup:` faux bot; in its chat send `/code cwd=<dir> echo: handoff-<stamp>`: link `Open in Code`, `Shelley started a thread`, then `reply relayed into this chat` and `handoff-<stamp>`. `Open in Code` lands on a thread whose transcript shows `handoff-<stamp>`.
- **Proof.** `ta-verify drive $S/journeys/code.mjs` → `code/cwd-invalid`, `working-steer-queue`, `turn-done`, `stopped`, `changes`, `unread`, `group-folded`, `archived`, `settings`, `handoff`.

## Gotchas

- Shelley runs on the HOST: always give threads a cwd under `data/verify/<run>/` (never the repo or `$HOME`). Avoid `patch success` (writes `/tmp/test-patch-success.txt` on the host).
- The predictable model titles every thread `edit-predictablego-to-add-a-response-for-that-one[-N]`; rename to a stamped title before relying on titles.
- Shelley (upstream, reproduced on its API alone) drops the answer to a steer when a queued message follows it within ~1 s; the journey waits 4 s between them.
- The thread list lags a new thread by a few seconds; poll the API before reading a new thread's row.
- A folder group is named by the basename only: match its region and `New thread in <label>` with `exact: true` (`work-<stamp>` is a prefix of a worktree's `work-<stamp>-<date>`), and the header's `New thread` with `exact: true` too.
- A folded group is remembered in `localStorage` (`tiny-agents:code-collapsed`); unfold what you fold.
- `New thread in …` and `<label> settings` show on hover only (opacity); Playwright clicks them anyway.
- The test of journey paths (`tests/client/verify-journey-routes.test.ts`) reads any `/settings/<x>` in a recipe as an app settings section: name Code settings sections by their link text, not by `/code/settings/<section>` paths.
- The "another thread is working in this directory" warning is shown only for harnesses without worktrees; Shelley has worktrees, so it never shows here.
- The relayed-reply line is split across elements (`Shelley` + `reply relayed into this chat`); match the second part.
