# Terminal

A real shell on the sandbox VM, inside the app (issue #28): a top-level
`/terminal` page renders tabs of [xterm.js](https://xtermjs.org) terminals,
each attached to its own tmux session on the VM. Tabs keep running when the
browser closes, the network roams, the app redeploys or the phone takes
over. The design target is the four ingredients exe.dev's
[exe-scroll](https://blog.exe.dev/exe-scroll) names for a remote terminal —
network roaming, session management, scrollback, modern terminal support —
delivered on this repo's own stack (tmux instead of a ghostty session
manager; the WS bridge and page do not change if the session manager swaps
later).

## Architecture

```
Browser: /terminal page
   one xterm.js Terminal per tab (fit + webgl addons, canvas fallback),
   reconnect with fresh tickets, resize as a control frame
   │ REST: list / create / kill / ticket
   │ WebSocket /api/v1/terminal/ws/:name?ticket=…&cols=&rows=
   │    binary frames = pty bytes both ways · text frames = control
   ▼
WebSocket bridge on the Node server (apps/web/src/server/api/terminal/terminal.ws.ts)
   single-use 60s ticket · Origin check · slow-client pause · bytes never logged
   ▼
terminal service (packages/agent/src/terminal) — stateless, port-shaped
   list/create/kill run one tmux command per exec;
   attach opens a pty shell channel on a FRESH ssh2 connection per tab
   ▼
sandbox VM
   tmux -L ta-terminal: one session (ta-term-<n>) per tab, history-limit
   50000, mouse on, status off — sessions outlive every layer above
```

Server code: `apps/web/src/server/api/terminal/` (routes, ticket WS bridge,
memoized service from `SANDBOX_*`). Domain code: `packages/agent/src/terminal/`
(`tmux.ts` pure command builders and parsing, `terminal.ts` the
service port + typed errors, `terminal-ssh2.ts` the ssh2 binding). Client
code: `apps/web/src/client/pages/terminal/` (`Terminal.tsx` the page and tab
strip, `TerminalView.tsx` one terminal) and `apps/web/src/client/lib/`
(`terminal-api.ts` typed client, `terminal-ws.ts` the socket lifecycle,
`xterm.ts` the one file that touches xterm.js). Tabs are capped at 12.

## The four ingredients

| exe-scroll ingredient | This feature                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network roaming       | The WS drops, the view retries with backoff (1, 3, 5, 10, 20, 30 s) and a **fresh single-use ticket per attempt**, and keeps the xterm buffer; the tab strip shows a pulsing dot while reconnecting. Output from the outage lands in tmux history and appears in the re-attach redraw.                                                                                |
| Session management    | A tab **is** a tmux session on the VM. The tab list is read from the VM and polled every 5 s, so tabs survive the browser, the app process and the device, and tabs opened from another device appear on their own. Every browser tab is its own tmux client (no `-d`: it closed the other device's view for good); `window-size latest` lets the one typing size it. |
| Scrollback            | tmux history (`history-limit 50000`) with `mouse on` — the wheel scrolls into history on the VM; the attach redraw repaints the visible pane. The buffer living on the VM is the design, not an accident.                                                                                                                                                             |
| Modern terminal       | xterm.js 6 renders (WebGL, DOM fallback) with unicode11 widths so emoji/CJK agree with tmux; tmux gets `RGB`/`clipboard`/`hyperlinks` features, so truecolor, OSC 52 copy and OSC 8 links pass through; resize propagates as a control frame through `setWindow` and tmux follows the SIGWINCH.                                                                       |

## Transport: a fresh SSH connection per exec and per attach

The ssh2 binding (`terminal-ssh2.ts`) does **no pooling**. Every tmux exec
dials a fresh connection and closes it; every pty attach gets a dedicated
connection that lives exactly as long as the stream. This mirrors the
lesson `browser-remote-cdp.ts` already encodes: tailscaled's SSH
multiplexing stalls later channels on a connection after a streaming
channel closes, and an attach is long-lived streaming — sharing its
connection would starve the execs around it (the same precedent as the
browser feature's CDP dials, which also dial fresh per socket).

## The WebSocket protocol

ttyd-shaped, two frame kinds:

- **Binary frames are raw pty bytes**, both directions, untouched. The
  bridge never parses or logs them — they are everything the owner types.
- **Text frames are control** (malformed or unknown ones are ignored, not
  fatal — a buggy client must not lose its terminal):
  - `{"t":"resize","cols":120,"rows":34}`, clamped 2..500 cols, 2..300 rows.
  - `{"t":"pause"}` / `{"t":"resume"}`: client flow control. The client
    counts bytes received but not yet parsed by xterm; past 512 KB it
    pauses the server (which stops reading the SSH channel), below 64 KB it
    resumes. Independent of the server's own 4 MB socket-buffer pause; the
    channel reads again only when neither holds.
  - `{"t":"ping"}`, answered `{"t":"pong"}`. Sent every 20 s **only while
    the page is visible**, plus once on every return to the page. No reply
    within 8 s means a half-open socket (a laptop that slept, a proxy that
    dropped it), so the client abandons it and reconnects at once. A hidden
    page sends nothing, so the 10-minute idle close still frees tabs nobody
    is looking at, but never one someone is reading.

Close codes are a contract with the client's reconnect logic:

| Code | Meaning                                           | Client behavior                                        |
| ---- | ------------------------------------------------- | ------------------------------------------------------ |
| 1000 | the tmux client was detached, or the session died | stop; overlay offers Reconnect; the poll shows truth   |
| 4000 | idle: ten minutes with no frames either way       | reconnect with a fresh ticket when the user returns    |
| 1011 | the SSH attach failed after the ticket was spent  | retry re-fetches a ticket, whose 404 stops it for good |

Auth follows the VNC bridge exactly: browsers cannot set WS headers, so the
page first calls `POST /terminal/sessions/:name/ticket` (normal session
JWT), then upgrades with `?ticket=`. The ticket is random 24-byte
base64url, **single-use, 60 s TTL, bound to one tab name and user**, spent
on first redeem. Ticket mints are rate-limited to 30 per user per minute
(the answer to abuse is 429, never 409 — the client reads ticket-409 as
"tab gone, stop forever"). The upgrade checks `Origin` like the VNC bridge.
Ping/pong every 30 s; a slow client is handled by pausing the SSH read side
past 4 MB queued, then resuming (the VNC bridge's constant).

Attach initial size rides the WS query (`?cols=&rows=`), validated at the
boundary. The client measures before it connects, so tmux attaches at the
rendered grid instead of 120x34 followed by a full-screen redraw.

## Clipboard

Why paste used to fail: xterm.js encodes Ctrl+V as `^V` and cancels the
key event, so the browser never fired `paste` (on Windows/Linux only
right-click paste worked). `classifyKey` in `lib/xterm.ts` returns `false`
for the paste chords (Ctrl+V, Ctrl+Shift+V, Shift+Insert; Cmd+V on macOS)
**without** `preventDefault`, so the browser's native paste event reaches
xterm's textarea and xterm sends it bracketed. This needs no clipboard
permission and works on plain http, where `navigator.clipboard` does not
exist. Coolify and AgentsInTheCloud fix it the same way.

Copy has two routes:

- **tmux selection** (plain drag, double-click): tmux owns the mouse
  (`mouse on`), so it makes the selection and, with `set-clipboard on` and
  the `clipboard` terminal feature, sends it out as OSC 52. The xterm
  clipboard addon gets a custom provider: tmux sends an _empty_ selection
  parameter, which the stock provider ignores (it only accepts `c`), and
  clipboard **reads** (`ESC]52;c;?`) are refused so a program on the VM can
  never read the owner's clipboard. A "Copied" toast confirms.
- **local selection**: Shift+drag (Option+drag on macOS,
  `macOptionClickForcesSelection`) selects in xterm; Ctrl+C with a
  selection, Ctrl+Shift+C, or Cmd+C copies it (Ctrl+C without one stays
  `^C`). Writes fall back to `execCommand("copy")` off https.

Right-click opens a Copy / Paste / Select all menu (tmux's own right-click
menus are unbound). Its Paste, like the keys panel's, needs
`navigator.clipboard.readText`; where that is missing or refused it tells
the owner which chord to press instead. Pastes from the panel go through
`term.paste()`, so a multi-line paste is bracketed and does not run line by
line.

## Keys panel and full screen

- **The keys panel is a registry consumer, not a view sibling.** Each
  `TerminalView` publishes `{ send, focus }` through `onControls` on socket
  connect (and `null` on dispose); the page keeps them in a ref map keyed by
  tab name. The panel resolves `get(active)` **per press**; the map fills
  asynchronously after first render, so a render-time prop would forever
  see the pre-connect `undefined`. No re-render on socket lifecycles.
- **Key composition is data, not branches.** Keys are `PanelKey` records
  (`char` for typeable characters, `seq` for fixed escape sequences; `^C`
  _is_ Ctrl+C already). Sticky `ctrl` masks a typeable character
  (`c & 0x1f`), `alt` prefixes ESC; any press consumes both modifiers.
- **The panel is one element, responsive by CSS.** Below `md` it is
  `absolute right-1 top-1 bottom-1 z-10 w-28` inside the terminal row with
  `bg-background/80 backdrop-blur-sm`, an overlay, so the terminal's box
  never changes when it opens (no resize, no refit, the grid stays put).
  At `md+` it docks as a `w-44` static column with `border-l
  border-border/50`. Only the `md` crossing changes the terminal's column.
- **Phones start collapsed.** First paint without a stored preference
  reads `matchMedia("(max-width: 767px)")`; `localStorage
  tiny-agents:terminal-keys` ("1"/"0") overrides forever after. Toggle is
  the header Keyboard button (`terminal-keys-toggle`) or the panel's own
  chevron (`terminal-keys-collapse`); the panel unmounts when hidden.
- **Full screen is CSS-first.** `terminal-region` swaps to `fixed inset-0
  z-40 p-2` (rounded/ring off, the terminal row already `flex-1`), and the
  Fullscreen API is best-effort chrome-hiding on top; iOS Safari never
  fullscreens a div, so the class is the source of truth, and
  `fullscreenchange` only syncs the icon when the API works. Esc stays
  reachable through the panel's esc key while
  `navigator.keyboard.lock(["Escape"])` holds it. The debounced refit after
  entering/exiting is covered by the existing ResizeObserver path.

## Session model and UI behaviors

- **Hidden hosts never fit.** A `display:none` host measures 0x0; fitting
  it would shrink the pty and make tmux redraw everything twice. The view
  column is `min-w-0 overflow-hidden` so the grid takes its width from the
  layout, never from xterm's canvas (a bigger font used to widen the
  column, which refit the grid, which widened it again).
- **A re-attach starts from a clean terminal.** On every reconnect after
  the first, the view calls `term.reset()` before tmux's redraw lands, so
  modes left by the old attach (mouse tracking, bracketed paste, alt
  screen) cannot bleed into the new picture.
- **Tabs are always mounted, hidden with `display:none`.** One
  `TerminalView` per session exists for the whole time the session is
  listed; xterm.js happily renders into a `display:none` host (it just has
  no measurable box until shown). Switching back is a local repaint, not a
  reconnect; output landing on a background tab is already in its buffer
  when the owner returns. Activation refits and focuses.
- **Resize has one path and a 150 ms debounce.** A `ResizeObserver` on the
  host collapses box changes into the last one; `fit()` changes the grid,
  `onResize` reports it, and the handler sends the control frame. The first
  fit usually lands while the socket is still opening, so the grid is
  re-sent once the socket is live — the pty always starts at the rendered
  size. "New tab" opens at the current grid (`initialSize`).
- **Close asks when real work would die.** `DELETE` answers 409 with the
  foreground process name when the pane runs anything besides the login
  shell (read from `$SHELL` on the VM, not a hardcoded list); the UI then
  confirms ("vim is running in this tab") and re-issues the delete with
  `?force=1`. A plain shell closes at once. The tab strip shows the
  foreground process as a muted suffix while one runs.
- Empty, setup and failed states use `EmptyState`/`ErrorState`: no tabs
  ("Open your first tab"), `SANDBOX_HOST` unset, tmux missing (with the
  exact install command), sandbox unreachable.
- Font size is one setting for every tab (A−/A+ in the header, Ctrl/Cmd
  `=`/`-`/`0` in the terminal), persisted per browser; a cols×rows badge
  shows while the grid changes. Links open with Cmd/Ctrl+click only.

## API

| Method | Path                                            | Description                                                                                            |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/terminal/sessions`                     | `{ status, sessions }` in one dial (status: ready/unconfigured/unreachable/tmux-missing)               |
| POST   | `/api/v1/terminal/sessions`                     | `{ cols?, rows? }` → 201 `TerminalSession`; 409 at the 12-tab cap; 503 sandbox/tmux problems           |
| DELETE | `/api/v1/terminal/sessions/:name?force=1`       | kill the tab; 409 + `error.details.process` when a non-shell process runs (unless forced); 404 unknown |
| POST   | `/api/v1/terminal/sessions/:name/ticket`        | `{ path }`: one-time WS ticket, path already carries `?ticket=`                                        |
| GET    | `/api/v1/terminal/ws/:name?ticket=&cols=&rows=` | WebSocket upgrade; binary = pty bytes, text = control                                                  |

`TerminalSession = { name, process, attached, createdAt }` (process is
`pane_current_command`, null at the shell). All REST routes are
JWT-protected; sessions are named `ta-term-<n>` with the lowest free n, so
numbers never shuffle after a delete.

## Env

`SANDBOX_HOST`, `SANDBOX_PORT`, `SANDBOX_USER` (all existing; see
`.env.schema`). No new vars, no schema changes. Without `SANDBOX_HOST` the
page shows the "Sandbox not configured" state.

## Running the tests

Deterministic page e2e (no VM needed; the API is stubbed with
`page.route`):

```sh
pnpm test:e2e -- tests/e2e/terminal.spec.ts
```

The live e2e needs the VM over the tailnet, so it skips itself when
`SANDBOX_HOST` is unset:

```sh
SANDBOX_HOST=tiny-agents-vm pnpm test:e2e -- tests/e2e/terminal.live.spec.ts
```

It asserts on WS frames (`page.on("websocket")` → framereceived /
framesent), never canvas pixels — xterm renders on WebGL, which no DOM
query can see into. Server tests (`tests/server/routes/terminal.*.test.ts`,
`tests/server/app/agent/terminal-*.test.ts`) run against an in-process SSH
server, no VM either.

## LC_ALL=C.UTF-8: the tmux lesson

Every tmux command the feature runs is prefixed `LC_ALL=C.UTF-8`. ssh2 exec
sessions carry no `LANG`, and tmux 3.4 then falls back to a non-UTF-8
locale where it (a) replaces TAB with `_` in `ls -F` output, breaking the
frozen wire format, and (b) mangles every non-ASCII byte it draws to an
attached client. The prefix must also be on `new-session` so the tmux
_server_ itself starts UTF-8. Verified live against tiny-agents-vm (tmux
3.4, locale C.utf8 present).
