# Code extras

Beyond a basic thread (`code.md`), the `/code` workspace lets the owner browse the coding agent's folders for a working directory, start a thread in a fresh git worktree, find each repository's (and worktree's) threads in their own fold-away group of the thread list, change a thread's model and reasoning, get `/` command hints and `@` file completion in the composer, pick skills and attach images and files to a message (shown inline or as links), open the usage popover from the context ring, fork a thread from any message, change a thread's working directory, send a queued message right away or cancel it, and recover from a refused turn.

## Sub-features

- `code-folder-browser` `Working directory` → option `Browse folders…` → dialog `Choose a working directory`: the path (`· git` inside a repo), `..`, folder buttons (no hidden folders), `No folders here.`, `Use this folder`.
- `code-worktree` `New worktree` (`aria-pressed`) on a git directory → `Start` makes a sibling worktree `<dir>-<date>` and starts the thread there.
- `code-repo-groups` `Code threads` groups threads outside a project by repository root (else working directory): one region per folder, named by its basename, so a worktree gets a group of its own beside its repo; the heading button folds it (`aria-expanded`); `New thread in <label>` links to `/code/new?cwd=<path>`. (The old `Repository` and harness filters are gone.)
- `code-chips` composer `Model` (the harness's models) and `Reasoning` (`Auto`, `Low` … `High` …) on a thread: toast `Takes effect on the next turn`, saved on the thread. No `Permissions` chip on Shelley.
- `code-slash` typing `/` lists listbox `Commands` (`/model`, `/compact`, `/btw`, `/fork`, `/cwd`, `/new`, `/help` with hints); Enter or Tab inserts.
- `code-at-files` typing `@` lists listbox `Files` from the thread's directory; Enter inserts `@<path> `.
- `code-skills` `Add files or skills` menu → `Skills for this message` (checkbox items, the harness's skills); a chip `Remove skill <name>`; the next message carries them.
- `code-attachments` `Add files or skills` → `Add files or images` (also paste and drop): chips `Remove <file>` while uploading/ready; the sent message shows images inline and other files as links, served by the asset route.
- `code-usage` the context ring `Context N% full. Usage` → popover `Context usage` (tokens, Total / Subtotal per model, `Compact in Place`).
- `code-fork` hover a user message → `Fork from here` → a new thread (title `…-fork`) holding the conversation up to that message.
- `code-change-cwd` thread actions → `Change directory` → dialog `Change working directory`: a missing path is refused (toast, dialog stays); a valid one applies to later tools.
- `code-queued-actions` on `code-queued`: `Send now` (interrupts the turn, runs the message) and `Cancel queued message`.
- `code-recover` a refused turn (`[The model declined to continue …]`) offers `Try another model` (recover `continue`).
- Not driven: `Retry` (needs a retryable error; the predictable model's `error:` and `fail` errors are not retryable), `Resume` (needs a turn interrupted by a Shelley restart), `Compact in Place`, `Kill job` (background jobs), subagents and `Stop subagent`, `Open in Shelley`, drag-and-drop and paste uploads, the harness pickers.
- Unreachable here: `Permissions` chip and approval/question cards (`POST …/requests/:rid`) and the Claude Code side of `Kill job`: the Claude Code harness (a Claude plan account and a signed-in Claude Pro/Max account). `Try another model` actually switching models needs a second model (a real provider in Shelley).

## How to get to it (user POV)

- Sidebar `Primary` → `Code` → `New thread` (`/code/new`): working directory, `New worktree`, composer.
- A thread page: the composer's chips, `+` menu, `/` and `@`; the title's `<title>: thread actions` menu; hover a message for `Fork from here`.
- The thread list's groups (`Code threads`), one per repository or folder.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --shelley` (journey requires `shelley`). Shelley runs on the host with its keyless `predictable` model. Predictable prompts used: `echo: X` → `X` (echoes appended upload tokens too), `delay: N`, `bash: CMD` → `Done.`, `refusal` → a refusal error; `error: X` and `fail X` give non-retryable errors.
- Probe its API with `curl --noproxy '*' http://127.0.0.1:<port+1000>/api/...` (`/models`, `/list-directory?path=`, `/find-files?dir=&q=`, `/skills?cwd=`, `/git/create-worktree`, `/conversation/<id>/fork`, `/conversation/<id>/{retry,resume,continue}`).

- **Setup.** `setup:` git repo `data/verify/<run>/work-<stamp>` with `a.txt`, `alpha-<stamp>.txt`, `sub/keep.txt` (committed). Cleanups: delete every thread (active and archived) whose cwd is the repo, under it, or the worktree; `git worktree remove --force` the worktree; remove the stamped uploads from the host's `/tmp/shelley-uploads`; remove the repo.
- **Folder browser.** `/code/new` → `Working directory` → type the repo path → Enter. Again → `Browse folders…`: `GET …/directories` 200; `<dir> · git`; no `.git`; `sub` → `<dir>/sub · git`, `No folders here.`; `..` → back; `Use this folder` → the button reads `…/<run>/work-<stamp>`.
- **Worktree.** `New worktree` (pressed) → `echo: wt-<stamp>` → `Start`: `POST …/worktrees` 201 with `path` `<dir>-<date>`; the reply shows; `git worktree list` has it, `a.txt` is in it, the thread's API `cwd` is it.
- **Main thread.** `New thread` (exact name; each group also has `New thread in <label>`): directory remembered, `New worktree` not pressed; `echo: main-<stamp>` → `Start`; API `cwd` = the repo. `setup:` rename both threads `main-<stamp>` / `wt-<stamp>` via the API.
- **Repository groups.** Region `work-<stamp>` lists `main-<stamp>` only; region `<basename of the worktree>` lists `wt-<stamp>`, and its `New thread in <basename>` has href `/code/new?cwd=<encoded worktree>`. Its heading button folds it: `wt-<stamp>` gone, `main-<stamp>` stays; again unfolds.
- **Chips.** `Reasoning` → `High`: `POST …/settings {effort: "high"}` 200, toast, API `settings.effort: "high"`, still `High` after a reload. `Model` → `predictable`: `{model: "predictable"}` 200, API agrees. `code-permission` absent.
- **`/` and `@`.** `/fo` → `Commands` has `/fork … copy of this conversation` → Enter → `/fork `. `echo: see @alph` → `Files` has `alpha-<stamp>.txt` (`find-files` with `dir` = the repo) → Enter → `echo: see @alpha-<stamp>.txt ` → Enter: reply `see @alpha-<stamp>.txt`.
- **Skills.** `Add files or skills` → `Skills for this message` (`GET …/skills` 200) → first checkbox item checked → chip `Remove skill <name>`; `echo: skill-<stamp>` → `POST …/messages` body `skills: [<name>]`; chip gone.
- **Attachments + asset.** `Add files or images` → file chooser: `shot-<stamp>.png` (1x1 PNG) and `notes-<stamp>.txt`: two chips, two `POST /code/uploads/shelley` 201, the text file is on the host. `echo: att-<stamp>`: body `attachments: ["file:/tmp/shelley-uploads/shot-…", "file:/tmp/shelley-uploads/notes-…"]`. The bubble shows `img "shot-<stamp>.png"` loaded (naturalWidth 1) from `/api/v1/code/harnesses/shelley/asset?ref=…` (200, `image/png`, byte-identical) and link `notes-<stamp>.txt` whose href returns the text; the bubble reads `echo: att-<stamp>` only.
- **Usage.** `Context N% full. Usage` → dialog `Context usage`, `GET …/usage` 200, tokens line, `Total` row, `Compact in Place`; Escape.
- **Fork.** Hover `echo: main-<stamp>` → `Fork from here`: `POST …/fork` 201 → URL is the new thread, its transcript has the message, API lists it in the repo; the original still has its later messages.
- **Change directory.** Back on main → `Change directory`: field holds the repo path; `/nonexistent-<stamp>` → `Change`: toast `… does not exist`, dialog stays, API cwd unchanged. `<dir>/sub` → `Change`: API cwd `<dir>/sub`; `bash: pwd > pwd-<stamp>.txt` → `Done.` and `sub/pwd-<stamp>.txt` holds `<dir>/sub`.
- **Queued actions.** `delay: 45`; Alt+Enter `echo: later-<stamp>` and `echo: dropped-<stamp>`: two rows, API `queued` length 2. `Cancel queued message` on dropped: `…/queued/<qid>/cancel` 200, row gone, API queue = later only. `Send now` on later: `…/queued/<qid>/send` 200; reply `later-<stamp>` within 30 s (well before the delay ends), queue empty, `Send` back, `dropped-<stamp>` never answered.
- **Recover.** `refusal` → `The model declined to continue` notice with `Try another model` → click: `POST …/recover {action: "continue"}` answers 400 and the toast says `Unknown or unavailable model` (predictable-only Shelley has no model to switch to).
- **Proof.** `ta-verify drive $S/journeys/code-extras.mjs` → `code-extras/folder-browser`, `worktree-thread`, `repo-groups`, `slash-commands`, `at-files`, `skills-menu`, `attachments-chips`, `attachments-rendered`, `usage-popover`, `forked`, `cwd-changed`, `queued-two`, `queued-sent-now`, `refusal`, `recover-continue`.

## Gotchas

- Shelley runs on the HOST: worktrees land beside the repo (`<dir>-<date>`, with `-N` on a clash) and uploads in the host's `/tmp/shelley-uploads/<name>`; use stamped names and remove them in cleanups.
- Folder groups come from the listed threads' repository roots (`repoRoot`, else `cwd`) and are named by basename only, so match regions with `exact: true` (`work-<stamp>` is a prefix of `work-<stamp>-<date>`). A folded group is remembered in `localStorage`: unfold it again. `GET /code/harnesses/:instance/repos` has no caller in the UI (and predictable Shelley answers `repos: null`, scanning only its own `HOME`).
- A folder inside a repo also reads `· git` in the browser; match `<path> · git`.
- The predictable `echo:` reply repeats the `[/tmp/shelley-uploads/…]` tokens the composer appends; check the user bubble, not the reply, for hidden tokens.
- Shelley refuses a directory change while a turn runs (`Finish or stop the current turn to change the directory`): change it on an idle thread.
- Shelley's cancel clears its queue, so `Stop` drops queued messages too; drive `Send now` / `Cancel` before stopping.
- `Fork from here` is hidden until the message row is hovered (`md:invisible`): hover first.
- `result.json` `consoleErrors` holds two expected `400`s: the refused directory change and the refused `continue`.
