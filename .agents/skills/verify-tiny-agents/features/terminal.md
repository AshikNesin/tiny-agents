# Terminal

The owner opens real shells on the sandbox VM from `/terminal`: each tab is a tmux session that keeps running when the browser closes, so a reload re-attaches to the same shell and redraws its output. Tabs show their foreground process; closing a tab that runs one asks first. A keys panel sends keys a phone keyboard lacks, the text size is shared by every tab, and the terminal can go full screen.

## Sub-features

- `terminal-open` opens a tab (`Open your first tab` on an empty page, the strip's `New tab` +, or the header's `New tab`) and streams the shell prompt.
- `terminal-type` sends keystrokes and shows the command's output.
- `terminal-reattach` keeps the tab across a reload; the re-attach redraws the pane.
- `terminal-tabs` switches tabs (tablist `Terminal tabs`); `/terminal?tab=<name>` opens on a given tab (Settings → Models → Claude plan links there).
- `terminal-keys` keys panel (complementary `Terminal keys`: esc, tab, arrows, home/end, pgup/pgdn, ^C ^D ^Z ^L ^R, sticky ctrl/alt, paste); `Hide keys panel` / `Show keys panel`, remembered per browser.
- `terminal-font` `Smaller text` / `Larger text`, the size badge resets.
- `terminal-fullscreen` `Full screen` / `Exit full screen`.
- `terminal-close` `Close tab <n>`: a plain shell closes at once; a busy tab shows the alertdialog `<process> is running in this tab` with `Force close`.
- Not offered by the UI: renaming a tab (tabs are numbered `ta-term-<n>`, lowest free number).
- Not driven: right-click Copy / Paste / Select all menu and clipboard paste (need clipboard permissions), the reconnect overlay after a dropped socket.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Terminal` (`/terminal`), or ⌘K → `Terminal`.
- Only useful with a sandbox: without `SANDBOX_HOST` the page shows `Sandbox not configured`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox` (local sandbox container running), doctor OK. The journey requires `sandbox` and reports UNREACHABLE without it.
- Only one `--sandbox` run at a time: tabs live on the shared container.

- **Open.** Note `GET /api/v1/terminal/sessions` names, open a tab, and adopt the one new name (`ta-term-<n>`); register a force-delete cleanup for it. `terminal-tab-status-<name>` reaches `data-state=live`; `tmux -L ta-terminal ls` in the container lists it.
- **Type.** Click `terminal-view-<name>`, type `echo "v$((6*7))-<stamp>"`, Enter. A received WebSocket frame on `/api/v1/terminal/ws/` contains `v42-<stamp>` (the typed text does not); `tmux capture-pane -p -t <name>` has it too.
- **Reload.** `page.reload()`: the tab is listed, goes live, and a received frame again contains `v42-<stamp>` (attach redraw).
- **Second tab + deep link.** Strip `New tab` → second name selected; `/terminal?tab=<first>` selects the first; clicking the second switches back.
- **Keys.** `Arrow up` sends a frame `ESC [ A`, `Ctrl+L` sends `\x0c`, `Ctrl+C` sends `\x03`. `Hide keys panel` removes the panel and stores `tiny-agents:terminal-keys=0`; `Show keys panel` restores it.
- **Font.** `Larger text` makes `terminal-font-size` read default+1; clicking the badge resets it.
- **Full screen.** `Full screen` (exact) → `document.fullscreenElement` is `terminal-region`, which fills the viewport. Leave with `document.exitFullscreen()` (stands in for Esc) and the button reads `Full screen` again.
- **Busy close.** In the second tab run `sleep 600`; within ~5 s the tab shows `sleep`; `Close tab <n>` → alertdialog `sleep is running in this tab` → `Force close`; the tab and its tmux session are gone.
- **Plain close.** `Close tab <n>` on the idle first tab: no dialog, tab and session gone.
- **CSS-only full screen.** A second page with `Element.prototype.requestFullscreen` deleted (iPhone Safari has none for a div): `Full screen` makes the region `fixed`; `Exit full screen`, inside the region, must leave it (regression check for #170).
- **Proof.** `ta-verify drive $S/journeys/terminal.mjs` → `terminal/open`, `command-output`, `fullscreen`, `busy-close-confirm`, `closed`, `css-fullscreen`.

## Gotchas

- Regression check for #170 (fixed 2026-11): in full screen the region covers the page header, so the exit control now lives inside the region (`terminal-exit-fullscreen`) and the header shows only `Full screen`. Under the real Fullscreen API the header is not rendered either; the in-region exit or the browser's Esc leaves.
- Assert on WebSocket frames, never canvas pixels: xterm renders on WebGL. Text the shell echoes as you type also arrives as frames, so make the expected output differ from the typed text.
- Two buttons are named `New tab` (header and strip); scope to the tablist. `getByRole` names match substrings: use `exact: true` for `Full screen` (else it also matches `Exit full screen`).
- The VM's bash history persists between drives; `Arrow up` can recall an old command into the line. Send `Ctrl+C` before typing the next command.
- The process suffix comes from the 5 s poll; allow ~20 s. Clean up only the tab names this drive adopted (`DELETE /api/v1/terminal/sessions/<name>?force=1`), never every `ta-term-*`.
- Headless Chromium grants the Fullscreen API but ignores Esc, so exiting is the `exitFullscreen()` harness step.
