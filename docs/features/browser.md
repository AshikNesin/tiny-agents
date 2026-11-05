# Browser Feature

First-class browser capability (issue #24): each bot can drive a real
Chrome. The owner watches it live in the chat UI, can take full control
mid-run (mouse, keyboard, tabs, clipboard, full screen), and can type secrets
that must never reach the model.

## Architecture

```
One browser per profile, one tab per bot (profile dirs: on the VM remotely; local: ./data/browser-profiles/<profile>)

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
- Perception: `browser_snapshot` is Playwright's accessibility snapshot
  in `ai` mode. It lists the interactive elements and gives each a ref
  (`e12`, or `f1e12` inside a frame). Clicking and typing resolve those
  refs with `getByRef`, the same path Playwright MCP uses. Vision is the
  `browser_screenshot` fallback (CSS-pixel scale, so a 2x desktop does not
  double the image the model pays for).
- Interaction uses those Playwright actions. `browser_click` clicks the
  ref: it scrolls the element into view and retries until that element is
  the one under the cursor. `browser_type` replaces the field with one
  `fill`. On the headful VM Chrome, CDP text insertion is delivered to
  whichever surface has browser focus, often the address bar, so a text
  field is clicked first to move that focus into the page. Date, color and
  range fields are filled directly, and a select gets the option whose label
  or value is the text (`selectOption`; `fill` throws on a select), so the
  native picker stays closed. A key event per character is a round trip each over the VM link
  and timed out on anything longer than a short phrase. Scrolling parks
  the cursor in the page before the wheel event.
- Driver flag: `setDriver(conversationId, "agent" | "human")`. Action tools
  wait (bounded) while the human drives; the next snapshot absorbs whatever
  the human did. When the owner releases control, the agent adopts the tab
  that is in front (the page whose `document.visibilityState` is `visible`),
  so tabs the owner opened or switched to are not lost. If the agent's tab is
  closed, it moves to the most recent remaining tab.
- Sessions: lazy start on the first browser tool call or "Open browser",
  idle-closed after 10 minutes (`BROWSER_IDLE_MINUTES`; an open viewer counts
  as activity), `DELETE /bots/:id/browser/profile` wipes the profile for a
  fresh identity. Concurrent opens of the same profile share one launch.
- **A dead browser is dropped, not kept.** If Chrome goes away (killed, the VM
  restarted, the CDP link lost), the session reports it
  (`BrowserSession.onDisconnect`) and `browser.ts` removes it from the live
  table: the panel's status turns inactive ("Closed"), agent tools that were
  waiting on the owner are released, and the next browser tool call opens a
  fresh browser. Without this a dead session kept answering "active" while
  every resize and tool call quietly did nothing.

## Profiles

Bots share one browser profile by default (`shared`), so a site the owner
signs into once is signed in for every bot. A bot that needs separate logins
(a second account, a clean identity) is set to its own profile in the bot
dialog (Tools, Browser, "Browser profile": Shared or Own); that is the
`browserProfile` column on the bot (`"shared"` or `"own"`).

- **One Chrome per profile.** Chrome locks its profile directory, so the bots
  on a profile share one browser: the profile key names the browser and its
  directory (`shared`, or `bot-<id>` for a bot's own). The app maps a bot to
  its `BrowserTarget` (profile and tab) in `browser.targets.ts`; the toolkit
  resolves tool calls through `resolveTarget`, since a tool call knows its
  conversation, not its bot.
- **A tab per bot.** The first bot in a browser gets its first tab, later bots
  a new tab each (`BrowserSession.openTab`), keyed by bot id, so "New chat"
  keeps the bot's tab. A tab the owner closes is replaced by a tab no other bot
  holds (or a new one); after a takeover only the bot whose panel released
  control adopts the tab left in front.
- **The acting bot's tab comes to the front** (`focus`) when another bot acted
  last, so the live view shows whoever is working and Chrome does not throttle
  a background tab. Opening the panel (start, VNC ticket) brings that bot's tab
  forward. Nothing is refocused while the owner drives.
- **Shared controls.** Take control, the live view and Reset act on the whole
  browser: while the owner drives, every bot on it waits, and resetting the
  shared profile signs every bot on it out (the panel asks first and says so).
- Changing a bot's profile takes effect on its next browser call; its old tab
  stays in the shared browser until that browser idles out.

## The viewer

`BrowserPanel` renders the stream with [noVNC](https://novnc.com) on a canvas
(lazy-loaded; pinned to an exact version because `lib/novnc.ts` patches a
private method).

The panel is one card (`Card` from `@groot/ui`): a header over the viewport.
The header has the title, a status line, and the tools. The status line is a
dot and label (Live, Connecting, Reconnecting, Starting, Headless, Closed),
then who is driving ("Surfer drives", "You drive") and the agent's current
URL (hidden while you drive, since the streamed Chrome has its own address
bar). The tools are Take control or Release control, Paste (while you drive),
Full screen, then Reset and Close as icons. The header is a container: Paste
and Full screen show their label when it is at least 36rem wide, the hand-off
button and the driver and URL parts of the status line from 28rem. Below that
the buttons shrink to icons and the status line is just the connection, so the
panel works from its 360 px minimum up. On a phone the panel is a full-screen
overlay; on desktop it is an inset card beside the chat.
The closed, starting, headless and failed states use `EmptyState` and
`ErrorState`, with a spinner overlay on the viewport while connecting.

- **Sharp on Retina.** The remote desktop is requested at `BROWSER_SCALE` x the
  panel size and Chrome runs with `--force-device-scale-factor` to match, so
  text is real pixels instead of an upscaled blur.
- **Fits its box.** A `ResizeObserver` (150 ms debounce) posts the viewport
  size to `/browser/resize`, which resizes the Chrome window through CDP
  (`Browser.setWindowBounds`). Only one request is out at a time; if the box
  changed meanwhile, the viewer refits to the latest size afterwards, so the
  last size always wins. A failed fit is retried twice, a second apart:
  entering full screen has no later resize to repair it. Chrome will not draw a
  window narrower than 500 CSS px, so a narrower viewer (the 360 px panel, a
  phone) asks for a 500 px window of its own shape and noVNC scales it down
  instead of cropping it (`lib/remote-window.ts`). The panel width is
  draggable and remembered in `localStorage`.
- **Full screen.** The header button calls `requestFullscreen()` on the panel
  and, where supported, locks keys (`navigator.keyboard.lock`) so Esc and
  browser shortcuts reach the remote Chrome. In full screen the panel drops
  its padding, radius and ring, so the viewport (and the Chrome window fitted
  to it) is the whole screen. Esc goes to the remote Chrome, so leave with the
  "Exit full screen" button.
- **Take control.** The viewer starts view-only. "Take control" enables input
  and focus; "Release control" hands the browser back to the bot. On a Mac, Cmd
  shortcuts are sent as Ctrl shortcuts to the remote Linux Chrome.
- **Clipboard.** Text copied in the remote Chrome lands on your clipboard.
  "Paste" (or Cmd+V on a Mac while driving) sends your clipboard to the remote
  one and presses Ctrl+V.
- **Reconnects** with backoff (1, 3, 5, 10, 20, 30 s) when the socket drops.
  Reset closes the browser, wipes the profile and returns to "Open browser".

Without a VNC display (local fallback, no `SANDBOX_HOST`) the panel shows
"No live view for this browser" with the current URL, and Take control, Paste
and Full screen are not offered.

## Browser page

`/browser` (sidebar, after Computer; issue #160) gives the owner the bots'
browsers directly, the way the Computer page gives them the desktops:

- **One tab per browser:** Shared (the default; every bot on the shared
  profile) and one per bot with a profile of its own. Each tab shows whether
  the browser is live, starting, failed or closed. The choice is remembered
  (`localStorage`), and `/browser?profile=bot-<id>` opens a given browser; an
  unknown profile falls back to Shared. The chat's Browser panel links here.
- **The owner has a tab of their own** in every browser, keyed `owner`
  instead of a bot id. "Open browser" opens the browser if needed and brings
  that tab to the front, so the page never lands in a bot's tab. Handing
  control back from the page moves only the `owner` tab to the tab left in
  front, so every bot's tab stays where it was (handing back from a chat
  panel gives that bot the front tab instead). The owner's tab closes with
  the browser.
- **The live view** is the panel's `VncView`, fit to the page through the
  page's own resize route, view-only until you take control. Taking control
  is the same driver flag the panel flips: every bot on that browser waits
  until you release it. **Paste**, **Full screen** (with keyboard lock) and
  **Reset** (closes the browser and wipes the profile; on Shared it names the
  bots it signs out) work as in the panel.
- **One window per browser.** The page and a chat panel both fit Chrome's
  window to their view; the last to connect or resize wins, and the other
  view scales.
- Without a sandbox VM (or with `BROWSER_EXECUTABLE_PATH`) bots browse
  headless, so the page says there is nothing to show and why.

Routes (JWT, owner only): `GET /browser` (the browsers, their state and
whether this server has a live view), `POST /browser/:profile/start |
vnc-ticket | resize | driver`, `DELETE /browser/:profile`; viewer socket
`/browser/:profile/vnc?ticket=`, with tickets of its own (a chat panel ticket
cannot open it, nor the reverse). Only `shared` and the `bot-<id>` of an
own-profile bot are accepted (`profiles.ts`, shared with the Computer page),
so the page cannot start a browser no bot owns.

## First run on a VM

The app installs what the browser needs the first time a bot opens one:
`tigervnc-standalone-server`, fonts and Google Chrome, over the same SSH
channel as the sandbox (passwordless sudo on the VM is required). The panel
shows "Setting up the browser on the VM" while it runs (a few minutes, once
per VM). `STACK_VERSION` in `browser-vm-setup.ts` names a marker file
(`~/.tiny-agents/browser-stack-v1`); bump it to re-run the install.

## Several bots at once

Every profile gets its own Xtigervnc display and Chrome on the VM, so the
shared browser and any number of bots' own browsers can be live at the same
time. Only the launches take
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

| Method | Path                                  | Description                                                                                                                   |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/bots/:id/browser`            | `{ active, profile, url, driver, mode, scale, starting, phase, error }`                                                       |
| POST   | `/api/v1/bots/:id/browser/start`      | open the browser now (returns at once; poll the status above)                                                                 |
| POST   | `/api/v1/bots/:id/browser/vnc-ticket` | `{ path, scale }`: one-time ticket for the VNC WebSocket (409 if no VNC)                                                      |
| GET    | `/api/v1/bots/:id/browser/vnc`        | WebSocket upgrade, RFB bytes over binary frames (needs `?ticket=`)                                                            |
| POST   | `/api/v1/bots/:id/browser/resize`     | `{ width, height }` in CSS pixels (320 to 4096 by 240 to 4096); 502 if the window could not be resized, 404 without a session |
| POST   | `/api/v1/bots/:id/browser/driver`     | `{ driver: "agent" \| "human" }`                                                                                              |
| DELETE | `/api/v1/bots/:id/browser/profile`    | close + wipe the profile                                                                                                      |

`mode` is `"vnc"` or `"headless"` (no live view). `phase` is `"installing"` or
`"starting"` while a launch is in flight. `profile` is `"shared"` or `"own"`;
`active` is the bot's browser (on the shared profile, possibly opened by
another bot) and `url` is the bot's own tab, `null` until it has one.
`start` and `vnc-ticket` also open the bot's tab and bring it to the front.

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
- Bots sign in, enter 2FA codes and pay through the [vault](./vault.md):
  `browser_fill_secret` and `browser_enter_code` fill a vault item on its exact
  origin (checked again inside the page), and `request_credentials` has you
  type into a sheet the server fills. The model never sees the values.
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
the VM's address; the machine needs keyless SSH to it, as for the sandbox. Off
the tailnet, run the local sandbox container instead
([`guides/local-sandbox.md`](../guides/local-sandbox.md)).

The remote transport's setup commands and its CDP and VNC sockets go
through the app's one sandbox connection (ADR 0013), which encodes the
Tailscale-SSH realities (verified live): after a direct-tcpip channel closes,
later channels on the same connection stall, so a closed forward retires its
connection and the next channel goes to a fresh one; handshakes occasionally
stall, so a failed dial is retried once. Opening a socket's channel can take a
dial, so the forwarder buffers the socket's first bytes or CDP's opening HTTP
request would be lost. SSH connection errors are always handled: an unhandled
`error` event on an ssh2 client would crash the server.

The local CDP forwarder (`createForwardingServer`) must be a raw `node:net`
server. Playwright reaches it with one HTTP request and then upgrades to a
WebSocket that stays open for the life of the session. An `http.Server` puts
the connection under its header timeout (60 s), so it cut the CDP link about a
minute after the last tool call: the browser kept running on the VM, the
viewer kept streaming it, but the agent's side was dead, and a resize
(full screen after a pause) silently did nothing. `browser-transports.test.ts`
guards this.

`createWindowResizer` fits the Chrome window and keeps the window's DevTools
session between resizes, so a resize is one round trip instead of four
(attach, look up the window, set it, detach). That is the difference between
about 0.4 s and 1.4 s on a link with a 300 ms round trip, and the Chrome window
is what lags behind the screen when you enter or leave full screen. It looks the
window up again when the first tab changes or the held session has gone stale,
and runs resizes one at a time, in order.
