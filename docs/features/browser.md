# Browser Feature

First-class browser capability (issue #24): each bot can drive a real
Chrome. The owner watches it live in the chat UI, can take full control
mid-run (mouse, keyboard, tabs, clipboard, full screen), and can type secrets
that must never reach the model.

## Architecture

```
One browser per bot, one profile dir per bot (remote: on the VM; local: ./data/browser-profiles/<id>)

Remote (SANDBOX_HOST set — production):
VM: Xtigervnc (private X display, localhost only)
      └─ headful google-chrome-stable  (full Chrome UI: tabs, address bar, extensions)
           └─ CDP on 127.0.0.1 (VM-only, ephemeral port)
App ──SSH (keyless Tailscale)──┬─ CDP tunnel ─► playwright-core connectOverCDP (the agent)
                               └─ VNC channel ─► ws bridge ─► noVNC canvas in BrowserPanel (the owner)

Local fallback (no SANDBOX_HOST):
in-process Playwright persistent context (headless=new), no CDP port, no display:
the agent can browse, but there is nothing to stream (the panel says so)
```

- **Same browser, two peers.** The agent drives through CDP; the owner drives
  through VNC pixels and keystrokes. Both act on the same Chrome, so tabs,
  logins and downloads are shared. VNC is the only live view: there is no
  separate screencast or input route.
- Toolkit: `packages/agent/src/toolkits/browser.ts` (port + tools),
  `browser-chromium.ts` (Playwright page session), `browser-remote-cdp.ts`
  (SSH transport), `browser-vm-setup.ts` (shell scripts that install and
  launch the VM stack). Wired in `bots.runtime.ts` beside the sandbox.
- Perception: `browser_snapshot` injects `data-ta-ref` attributes and
  returns a ref-annotated element tree; actions take refs. Vision is the
  `browser_screenshot` fallback (CSS-pixel scale, so a 2x desktop does not
  double the image the model pays for).
- Driver flag: `setDriver(conversationId, "agent" | "human")`. Action tools
  wait (bounded) while the human drives; the next snapshot absorbs whatever
  the human did. When the owner releases control, the agent adopts the tab
  that is in front (the page whose `document.visibilityState` is `visible`),
  so tabs the owner opened or switched to are not lost. If the agent's tab is
  closed, it moves to the most recent remaining tab.
- Sessions: lazy start on the first browser tool call or "Open browser",
  idle-closed after 10 minutes (`BROWSER_IDLE_MINUTES`; an open viewer counts
  as activity), `DELETE /bots/:id/browser/profile` wipes the profile for a
  fresh identity. Concurrent opens of the same bot share one launch.

## The viewer

`BrowserPanel` renders the stream with [noVNC](https://novnc.com) on a canvas
(lazy-loaded; pinned to an exact version because `lib/novnc.ts` patches a
private method).

- **Sharp on Retina.** The remote desktop is requested at `BROWSER_SCALE` x the
  panel size and Chrome runs with `--force-device-scale-factor` to match, so
  text is real pixels instead of an upscaled blur.
- **Fits its box.** A `ResizeObserver` (500 ms debounce) posts the panel size
  to `/browser/resize`, which resizes the Chrome window through CDP
  (`Browser.setWindowBounds`). The panel width is draggable and remembered in
  `localStorage`.
- **Full screen.** The header button calls `requestFullscreen()` on the panel
  and, where supported, locks keys (`navigator.keyboard.lock`) so Esc and
  browser shortcuts reach the remote Chrome.
- **Take control.** The viewer starts view-only. "Take control" enables input
  and focus; "Release" hands the browser back to the bot. On a Mac, Cmd
  shortcuts are sent as Ctrl shortcuts to the remote Linux Chrome.
- **Clipboard.** Text copied in the remote Chrome lands on your clipboard.
  "Paste" (or Cmd+V on a Mac while driving) sends your clipboard to the remote
  one and presses Ctrl+V.
- **Reconnects** with backoff (1, 3, 5, 10, 20, 30 s) when the socket drops.
  Reset closes the browser, wipes the profile and returns to "Open browser".

Without a VNC display (local fallback, no `SANDBOX_HOST`) the panel shows
"No live view for this browser" with the current URL, and "Take control" is
disabled.

## First run on a VM

The app installs what the browser needs the first time a bot opens one:
`tigervnc-standalone-server`, fonts and Google Chrome, over the same SSH
channel as the sandbox (passwordless sudo on the VM is required). The panel
shows "Setting up the browser on the VM" while it runs (a few minutes, once
per VM). `STACK_VERSION` in `browser-vm-setup.ts` names a marker file
(`~/.tiny-agents/browser-stack-v1`); bump it to re-run the install.

## Several bots at once

Every bot gets its own Xtigervnc display and Chrome on the VM, so any number
of bots can have a live browser at the same time. Only the launches take
turns: the launch script holds `~/.tiny-agents/browser-launch.lock` while it
picks a display and ports, and drops it as soon as Chrome answers.

- **A running browser never holds the lock.** The lock is fd 8 in the script,
  and Xtigervnc, vncconfig and Chrome are started with `8>&-` so they do not
  inherit it. A browser that did would keep the lock for as long as it ran, and
  every other bot's launch would hang until that browser was closed (10 idle
  minutes at most). `tests/server/app/agent/browser-vm-launch.test.ts` runs
  the real script against stand-in binaries to guard this.
- **Launches are bounded.** A launch that cannot get the lock in 25 s fails
  with "Gave up after 25s waiting for another browser to finish starting on
  the VM". The script's own waits add up to `LAUNCH_BUDGET_MS`, and the
  transport waits 20 s longer than that, so a script is never left running on
  the VM after the app has given up on it. A launch that fails midway tears
  down what it started.

## API

| Method | Path                                  | Description                                                              |
| ------ | ------------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/v1/bots/:id/browser`            | `{ active, url, driver, mode, scale, starting, phase, error }`           |
| POST   | `/api/v1/bots/:id/browser/start`      | open the browser now (returns at once; poll the status above)            |
| POST   | `/api/v1/bots/:id/browser/vnc-ticket` | `{ path, scale }`: one-time ticket for the VNC WebSocket (409 if no VNC) |
| GET    | `/api/v1/bots/:id/browser/vnc`        | WebSocket upgrade, RFB bytes over binary frames (needs `?ticket=`)       |
| POST   | `/api/v1/bots/:id/browser/resize`     | `{ width, height }` in CSS pixels (320 to 4096 by 240 to 4096)           |
| POST   | `/api/v1/bots/:id/browser/driver`     | `{ driver: "agent" \| "human" }`                                         |
| DELETE | `/api/v1/bots/:id/browser/profile`    | close + wipe the profile                                                 |

`mode` is `"vnc"` or `"headless"` (no live view). `phase` is `"installing"` or
`"starting"` while a launch is in flight.

## Security rules

- **Nothing browser-related is reachable from outside.** On the VM, VNC and
  CDP bind to 127.0.0.1 (`-localhost`, ephemeral ports) and are reached only
  through SSH channels the app opens. The VNC server has no password because
  it has no network exposure; the app is the authentication boundary.
- **The WebSocket is authenticated by a one-time ticket**, not by a header
  (browsers cannot set one on a WebSocket). `/vnc-ticket` requires the normal
  session JWT and a bot you own; the ticket is random, in memory, valid for 60
  seconds, bound to the bot and spent on first use. The upgrade also checks
  `Origin` against the request host and the configured CORS origins, and caps
  viewers at 4 per bot.
- **View-only is enforced in the client.** The bridge relays bytes without
  parsing them, so a modified client could send input while the bot drives.
  The viewer is already trusted with the whole browser (it is you); the agent
  absorbs whatever changed at its next snapshot.
- Navigation by the agent passes the same private-address rules as `web_fetch`
  (`checkPublicUrl`); `BROWSER_ALLOWED_PRIVATE_HOSTS` exempts named hosts. The
  owner can browse anywhere in the streamed Chrome, like any browser.
- Typing a secret while you drive goes to Chrome as keystrokes. Tool results
  never echo typed text, and the bridge never logs the bytes it relays.
- All agent action tools are approval-gated like every effectful capability
  (default ask, per-conversation always-allow).

## Env

`BROWSER_EXECUTABLE_PATH`, `BROWSER_IDLE_MINUTES`, `BROWSER_SCALE`,
`BROWSER_ALLOWED_PRIVATE_HOSTS` (all optional; see `.env.schema`).

**Where Chrome runs** — on deploys, not in the app container:

- `SANDBOX_HOST` set (production): the browser runs **on that VM** with a VNC
  display, as above. Closing a session kills the remote Chrome and VNC server
  (pids are recorded in the profile dir).
- `BROWSER_EXECUTABLE_PATH` set: a local binary (dev overrides).
- Neither: local fallbacks — `/headless-shell/headless-shell` (exe.dev VM),
  `/usr/bin/chromium` (Debian apt, via `railpack.json` `aptPackages`), then
  Playwright's bundled Chromium (`pnpm exec playwright install chromium`).

Without any of these, `browser_navigate` returns a setup hint naming the
options and nothing else breaks.

To try the VNC viewer from a laptop, set `SANDBOX_HOST` in your local env to
the VM's address; the machine needs keyless SSH to it, as for the sandbox.

Tailscale-SSH realities the remote transport encodes (verified live): after
a direct-tcpip channel closes, later channels on the same connection stall —
each incoming socket (CDP or VNC) dials a fresh SSH connection; the ~50ms
dial must buffer the socket's first bytes or CDP's opening HTTP request is
lost; and handshakes occasionally stall, so a channel dial retries once. SSH
connection errors are always handled: an unhandled `error` event on an ssh2
client would crash the server.
