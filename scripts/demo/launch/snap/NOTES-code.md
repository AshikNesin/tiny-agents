# Code states (`tools/stage-code.mjs`)

Run `node scripts/demo/launch/tools/stage-code.mjs` (desktop, then mobile) or
pass `desktop` or `mobile`. Before each mode it rebuilds its own instance on
port 3150 (3151 is Vite's HMR socket; data in `data/verify/code/`, log in
`server.log` there), plays the CAST scenario once, snapshots as it goes, and
leaves the last instance running. `--boot` only starts a fresh instance.

## How the instance is staged

- **Server:** the real server (`tsx apps/web/src/server/entry.node.ts`, faux
  mode, no keys), started with `--import stage-code-server/preload.mjs`. No
  product file changes; two module requests get stand-ins (`hooks.mjs`):
  - the faux model provider → `faux.mjs`: Code Buddy makes a real `code_start`
    call (`harness: claude-code`, the task, the cwd), says nothing after the
    card, and says the CAST closing line when "Reply from Claude Code" arrives.
    Anything else falls through to the app's own faux replies.
  - `code.registry` (asked for by `code.boot.ts`) → `registry.ts`: the real
    registry plus **Claude Code = the real driver + the real Claude worker
    (coding mode) in-process**, through the registry's own `extra` seam. Only
    the Agent SDK is a stand-in: the server tests' `FakeSdk` with a brain that
    plays the CAST thread, held at a gate (`data/verify/code/gate`) before each
    step so each running state can be snapshotted.
  - `preload.mjs` also starts the tests' fake Shelley (no threads, heartbeat
    every 20 s like a real one). With two harnesses the list labels each thread
    `CLAUDE CODE`.
- **Account:** first-run setup with the name `Ashik`. **Bot:** `Code Buddy`,
  `Fixes bugs and ships code`, created through `/api/v1/bots`.
- **Chat step 1** is typed into the real composer. The hand-off card, the
  finish ("Reply from Claude Code", delivered by the app's real Code watcher)
  and the closing line all come from the server.
- **Seeded through the API:** the thread is renamed to `Fix flaky checkout test`
  (`POST /code/threads/:id/rename`). Claude Code titles a thread with its first
  line.
- **Browser:** rows are opened and closed with real clicks. Two network
  rules apply in the staging browser only. Vite `full-reload` messages on the
  HMR socket are dropped, because every snapshot `.html` written under the repo
  reloads the open tab. The third-party feedback embed host is refused (rule 4),
  so the Code page has no feedback launcher.

## States (both modes)

- `codebuddy-handoff`: Ashik's message and the `code_start` card (Claude Code,
  working, spinner). Real flow plus edit 1.
- `codebuddy-chat`: the card (idle), the finish as a relayed peer card, and
  Code Buddy's closing line. Real flow plus edits 1 and 4.
- `code-list`: phones show `/code`, the list. Desktop shows the list beside the
  finished thread, because desktop `/code` is the new-thread screen led by the
  stand-in Shelley. Real flow plus edit 1.
- `code-running-fail`: the prompt, then Bash `pnpm test checkout` failed and
  expanded. Working indicator. Real flow plus edits 1 and 4.
- `code-running-diff`: the app folds the two finished calls ("Ran 1 command,
  edited 1 file · 1 failed") even mid-turn. The group and the Edit row are
  opened. Real flow.
- `code-running-pass`: the group is "Ran 2 commands, edited 1 file · 1 failed",
  with Bash `pnpm test` opened. Real flow.
- `code-done`: a fresh load of the finished turn: the folded group, the answer
  and `Worked for 2m 14s · $0.31`. Real flow plus edits 1 and 4.
- `code-done-open`: the same, with the group and all three rows opened, scrolled
  to the end. Real flow plus edits 2 and 3.

## DOM edits (text and attributes of app-rendered elements only)

1. `…/code/shop` (the app's `shortPath`) → `~/code/shop`, and `title`
   attributes holding the real path under `data/verify/code/home` → `~/code/shop`.
2. Scrolled transcripts only: the class `data-open:animate-accordion-down` is
   dropped from open rows. They animate from height 0 on mount, which clamps the
   saved scroll.
3. Scrolled transcripts only: an inline `contain-intrinsic-size: auto <h>px` on
   each `[data-slot=message-scroller-item]`. Items are `content-visibility:auto`
   with a 10rem placeholder, which also clamps the scroll on mount.
4. Mobile only: `[scrollbar-gutter:stable]` → `scrollbar-hide` on the
   transcript, as NOTES-inbox.md does it.

The composer is blurred before each snap. That is a focus change, not an edit.

## What the app does not show

- Claude Code rows carry no exit-code field (its normalizer sets none). The
  failure shows as a red row and a red Output block, whose first line is Claude
  Code's own `Exit code 1`. A passing run shows a terminal icon and no exit code
  anywhere; the app never renders `exit 0`.
- The hand-off card and the desktop list truncate the title. On phones the diff
  scrolls horizontally, so its long lines are clipped on the right.

## Selectors

- Hand-off card: `[data-testid="code-handoff"]`, with state text
  `working`/`idle`, `[aria-label="Working"]`/`[aria-label="Idle"]` and the link
  "Open in Code".
- Finish in chat: `[data-testid="peer-card"][data-peer="Claude Code"][data-relayed="true"]`,
  body `[data-slot="reply-card"]`. It reads "Claude Code · reply relayed into
  this chat", then "Claude Code finished **Fix flaky checkout test**. Open in
  Code", a blank line, and the answer. The bot's model receives it as
  `**Reply from Claude Code:** Claude Code finished …`.
- Transcript: `role=region[name="Messages"]`; rows `[data-testid="code-transcript"]`.
- Tool group: `[data-testid="code-tool-group"]`.
- Tool rows: `[data-slot="trace-collapsible-trigger"]` (role button, names
  `Bash pnpm test checkout`, `Edit tests/checkout.test.ts +3 −2`,
  `Bash pnpm test`), with `aria-expanded`. The failed row's line is
  `[data-slot="trace-line"][data-status="error"]`.
- Output and command: `[data-slot="code-block"]` titled `Output` or `Command`,
  with lines `[data-slot="code-block-line"]`. The exit code is the first Output
  line `Exit code 1`.
- Diff lines: `[data-kind="del"]`, `[data-kind="add"]`, `[data-kind="hunk"]`.
- Turn footer: `[data-testid="turn-divider"]`.
- Composers: Code `[data-testid="code-composer"]` (aria-label "Message Claude
  Code"); chat `textarea[placeholder="Message Code Buddy"]`.
- List row: `[data-testid="code-conversation-row"]` inside
  `role=navigation[name="Code threads"]`.
