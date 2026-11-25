# Code

The owner's coding workspace at `/code`: threads grouped by status on the left, the open thread in the middle, and a work pane on the right. Every action has a key; `?` lists them and ⌘K runs the same commands by name.

## Sub-features

- `code-list` groups threads under `Needs you`, `Working`, `In review` and `Done`. A finished turn nobody has read needs you; reading it moves the thread on.
- `code-move` `j` / `k` open the next or previous thread in the order shown; `u` jumps to the next one that needs you.
- `code-thread` shows the transcript streaming: thinking, a row per tool call, the answer.
- `code-steer` `c` focuses the composer. `Enter` steers a running turn, `Alt+Enter` queues for its end, a queued message can be sent now or cancelled, and `Escape` leaves the composer, then stops the agent.
- `code-pane` `1` Changes (the branch against its base), `2` Pull request, `\` hides or shows the pane, `[` the list.
- `code-new` `n` opens the new thread dialog; `Enter` starts the thread in its own worktree and branch.
- `code-rewind` `t` runs the last turn again and `e` edits it first: the files go back to how they were before that turn, with Undo.
- `code-files` `3` Files: the worktree as a folder tree with changed files marked; `p` filters it by name, `s` searches inside the files, a file opens beside the tree and saves with `⌘S`. `z` widens the work pane over the thread.
- `code-terminal` `4` (or `` ` ``) opens the work pane's Terminal tab, a shell in the thread's worktree.
- `code-commands` `:` opens the Code command menu: the page's commands and its threads.
- `code-keys` `?` lists every key; the command palette's `Code actions` group (`Chat actions` on the chat page) runs them.
- `code-legacy-links` a link from before the rebuild (`/code/<thread id>`, with `/changes` or `/pr`) lands on `/code/t/<thread id>` with that pane.
- `code-review-row` a pull request that waits for your review is a row under `Reviews` in the list; a click checks it out and opens `/code/reviews/<id>`. `v` takes a pasted link.
- `code-agent-review` `r` has the agent review the pull request: a brief and findings. `y` adds a finding to your review as a pending comment, `d` dismisses it. `Shift+A` and `Shift+X` open Submit review on Approve or Request changes.
- Not driven here: Code settings (`/code/settings`), which `tests/client/pages/code-settings.test.tsx` covers.

## How to get to it (user POV)

- The `Chat / Code` switch at the top of the sidebar, or ⌘K → a thread's title.
- Needs a coding agent: without one `/code` says `No coding agent is connected`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --demo-agent --fake-github --local-sandbox`, doctor OK. The journey requires all three and reports UNREACHABLE without them. The demo agent stands in for a model: it lists the directory, appends a line to `NOTES.md` and answers; `slow` in a message stretches the turn, `commit` commits the edit, `fail` ends it with an error, and a review request gets a fixed brief with two findings.

- **Setup.** `POST /api/v1/code/projects` (`acme/web`), then three threads through `POST /api/v1/code/threads`: two that finish, one `slow`.
- **List.** `/code`: the two finished threads sit under `Needs you`, the slow one under `Working`.
- **Move.** `Escape` (the new-thread box has focus), `j` opens the first row; its answer shows and its row moves to `Done`. `u` opens the other, and `Needs you` disappears.
- **Steer and queue.** In the working thread the hint under the composer reads `Enter steers · Alt+Enter queues · Esc stops`. `c`, type, `Enter`: the message joins the transcript and the thread still works. Type, `Alt+Enter`: it waits in `code-queued`.
- **Stop.** Cancel the queued message, `Escape` (leaves the composer), `Escape` again: `GET /api/v1/code/threads` reports the thread idle and the transcript ends with `Stopped.`.
- **Panes.** `1`: the Changes tab is selected and shows `NOTES.md` with the committed line. `2`: `is 1 commit ahead of main` and a Publish button. `\` and `[` hide and restore the pane and the list.
- **Keys.** `?` lists the keys; ⌘K → `Changes` selects the Changes tab.
- **Files and terminal.** `p`, type `notes`, click `NOTES.md` in the tree: the editor opens it beside the tree. `s` searches the worktree. `` ` `` opens the Terminal tab; wait for the prompt before typing. `:` → `Files` selects the Files tab.
- **Rewind.** `n` starts a thread from the dialog; `t` runs its last turn again from the files as they were. A message with `fail` ends the turn with an error and the row reads `failed`.
- **Review.** Publish the first thread, set the fake pull request's author through the fake GitHub's control server (the app's port + 3: `POST /pulls/<n>`, `POST /inbox`), then `/code`: the row under `Reviews` opens the review. `r`: the brief reads `Adds NOTES.md` and two findings show. `y`, then `d`: none stay open. `Shift+X`: the dialog is on `Request changes` with a summary; Submit, and `GET /state` on the control server lists the review under `submitted` with the added finding as its comment.
- **Open in editor.** Launch with `--local-sandbox` too, so the demo agent's SSH target has a port. The arrow button at the end of the thread header (or `o`) opens `code-open-editor` on Cursor with host `tiny-agents-sandbox` and the `~/.ssh/config` entry. Pick Zed, type a plain host: the entry goes and Copy link gives `zed://ssh/<host>/<worktree>`. Open in Zed, then a fresh tab: the dialog reopens on Zed with that host. Headless Chromium stops taking input in the tab that tried the `zed://` link, so check in a new tab. Proof: `ta-verify drive $S/journeys/code-open-editor.mjs` → `sandbox-config`, `zed`.
- **Threads everywhere.** `ta-verify up --demo-agent --fake-github` (the fake also offers `acme/api`, so two projects can exist): `/chats` shows a `Threads` region above the bots with the threads that need you or still work (`asks you` on the waiting one); a row opens `/code/t/<id>`, `All threads` opens `/code`. On an iPhone the chat drawer shows the same region, and the project chat's `Open menu` lands on `/code`. `TA_VERIFY_SHOTS=<dir>` also saves screenshots there. Proof: `ta-verify drive $S/journeys/code-threads.mjs` → `desktop-chat`, `desktop-thread`, `desktop-home`.
- **Project chat panel.** `ta-verify up --demo-agent --fake-github`: `/code/p/<id>` shows the `Project panel` region beside the chat with the project's threads grouped by state; `Search threads` narrows it; a row opens the thread in the panel (`?thread=<id>`) with `code-transcript`, `project-panel-pr` and a steer composer; `Back to threads` and the `Context` tab (Instructions). On an iPhone the panel is hidden until `Threads` is tapped, then fills the screen. `TA_VERIFY_BEFORE=1` takes only the plain chat shots. Proof: `ta-verify drive $S/journeys/code-project-panel.mjs` → `panel-threads`, `panel-thread`, `panel-context`.
- **Phone.** On an iPhone (touch) the list, the new thread box, the thread and the Files tab show no key hints; a long branch line stays on screen; the work pane's tabs fit on one line beside the close button. Proof: `ta-verify drive $S/journeys/code-phone.mjs` → `new-thread`, `thread`, `pane`, `files`.
- **Proof.** `ta-verify drive $S/journeys/code.mjs` → `code/list`, `steer-and-queue`, `stopped`, `changes`, `files`, `terminal`, `pane-and-keys`, `rewound`, `new-thread`, `review`.
