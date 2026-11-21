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
- Toolkit: `packages/agent/src/toolkits/browser.ts` (port + tools). In
  `packages/sandbox/src/`: `browser-sessions.ts` (session manager),
  `browser-chromium.ts` (Playwright page session), `browser-remote-cdp.ts`
  (SSH transport), `browser-vm-setup.ts` (shell scripts that install and
  launch the VM stack). Wired in `bots.runtime.ts` beside the sandbox.
- Perception: `browser_snapshot` is Playwright's accessibility snapshot
  in `ai` mode, made compact (`browser-snapshot.ts`): unnamed layout
  wrappers (`generic`, `rowgroup`, `cell`) are unwrapped, refs stay only on
  controls, clickable nodes and regions (`main`, `form`, `dialog`, …), and a
  link's URL goes on its own line as `[url=…]`. That is 50 to 70 percent of
  Playwright's output on real pages, with every piece of text kept. Clicking
  and typing resolve refs (`e12`, or `f1e12` inside a frame) with
  `getByRef`, the same path Playwright MCP uses. Refs stay the same across
  snapshots of one page, so the model can narrow a long page with `ref` (a
  region's subtree) or `query` (only the lines with those words).
- Long reads come in windows of 20,000 characters (about 5k tokens). The
  window ends at a line break and its note gives the `offset` to read on.
  Before, a snapshot was cut at the top and the rest of a long page could
  not be reached: scrolling does not change an accessibility snapshot.
- `browser_read_text` reads a page's or an element's `innerText`. On an
  article it is a fifth of the snapshot or less (Wikipedia: 101k characters
  of text against a 700k snapshot).
- Navigation waits up to 5 s past `domcontentloaded` for `load`, so a
  script-built page has something to read, and reports the page title. A
  click or Enter that starts a navigation (a new document or a script route
  change, watched for 500 ms) waits for that page the same way, so its
  result names where it landed and the next read is of the new page.
  `browser_back` goes back in the tab's history, behind the same guard.
- **Actions return the page after them**, so most steps need no separate
  snapshot. Navigate, back, and a click or key that opens a new page return
  that page's first 6,000 characters. On the same page, click, type, Enter
  and `browser_wait_for` return only the lines that changed since the last
  whole-page snapshot (`snapshotDiff`: lines compared as multisets, each new
  line under the unchanged line above it), or a one-line note when nothing
  changed or the change is over 4,000 characters. Refs are stable across
  snapshots, so a control that only changed state is one line. Focus
  (`[active]`) is left out of snapshots, because it moves with every action.
  Text that `browser_type` typed is replaced with `[typed text]` in its own
  result.
- **Tabs.** A click that opens a new tab (a `target=_blank` link, a
  `window.open`) takes the agent into that tab, after it loads, and the
  click's result says so. The tab it left stays open and the agent's.
  `browser_tabs` lists the agent's tabs, `select` goes on in one and
  `close` closes one. Every tab an agent holds stays guarded and claimed
  while open, so a background tab cannot load a private address and another
  agent never takes it; closing the agent's session, or releasing the
  browser's first tab, closes the tabs it opened.
- `browser_wait_for` waits until text shows or, with `gone`, goes away
  (Playwright's `getByText`, up to 30 s, default 10), or pauses a few
  seconds, instead of the model snapshotting in a loop while a page loads.
- Context: only the newest two long page reads (snapshot, text, or an
  action's page) are sent to the model; older ones become a one-line note
  after the action's own first line, dropped five at a time
  so the prompt cache keeps working (`context-trim.ts`, like screenshots).
  Vision is the `browser_screenshot` fallback (CSS-pixel scale, so a 2x
  desktop does not double the image the model pays for). With `labels`, each
  control in view gets its ref drawn on it for that one capture (OpenClaw's
  labeled refs): the refs come from a fresh snapshot, their boxes are looked
  up together (up to 150), and a fixed overlay that takes no clicks is
  removed right after, so a visual question can end in a click without a
  separate snapshot.
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
- **The computer's Chrome opens the same profile.** Chrome started on a bot's
  desktop ([computer](./computer.md)) runs with this profile's directory as
  its `--user-data-dir`, so logins, history and extensions are the same in
  both. Chrome lets one running browser hold a profile, so the last one opened
  wins: the desktop's Chrome stops this browser first (the panel shows
  "Closed"), and the next browser launch stops the desktop's Chrome
  (`pkill` on `--user-data-dir=<profile>`, then a wait of up to 10 s so the
  cookies are written). Both run with `--password-store=basic`, or one could
  not read the cookies the other saved. Reset stops either one before it
  wipes the profile.

## The viewer

`BrowserPanel` renders the stream with [noVNC](https://novnc.com) on a canvas
(lazy-loaded; pinned to an exact version because `lib/novnc.ts` patches a
private method). It is the chat's shared live-view panel
(`components/live/LivePanel.tsx`) on the browser's surface, and the Browser
page is the shared `LivePage`; the Computer's panel and page are the same two
components on the computer's surface (`components/live/surfaces.tsx`, every
difference a field; docs/rewrite/README.md §4.5).

The panel is one card (`Card` from `@groot/ui`): a one-row header over the
viewport. The header has the title (or the Browser / Computer tabs), one status
chip, and the tools as icons. The chip says who is driving once the stream is
live ("Surfer is driving", or a pulsing "You're driving"), and the connection
otherwise (Connecting, Reconnecting, Starting, Headless, Closed). The streamed
Chrome shows its own address bar, so the header shows the agent's URL only for
a headless browser. The tools are Hand back and Paste (while you drive), Full
screen, the page link, Reset and Close. The header is a container: in a
narrow panel the tabs keep only their icons and your chip is just its pulsing
dot, so the panel works from its 360 px minimum up. On a phone the panel is a full-screen
overlay; on desktop it is an inset card beside the chat.

The panel never opens on its own: a bot using its browser only lights the
chat header's live-view toggle (a pulsing dot, and "Surfer is using the
browser" in its label), and the owner opens the view from there.

- **Picture in picture.** The header's picture-in-picture button shrinks the
  panel to a small floating view over the chat (at most 20rem wide, its
  stream at most 18rem tall and shaped like the remote display),
  on desktop and on a phone, so the conversation stays readable while the
  bot browses. Drag its header to move it; the corner is remembered
  (`localStorage`), and so is the choice, so the toggle reopens it the same
  way. It only watches: the remote display and Chrome keep their size and
  the viewer scales them down (`VncView`'s `remoteResize` off), so the bot's
  pages keep their layout. A click on the
  stream, or Expand, brings back the panel; Hand back stays while you
  drive. The Computer panel has the same mode.
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
- **Take control.** The viewer starts view-only, and the stream itself is the
  "Take control" button: hover shows "Click to take control" (a touch screen
  always shows it), and a click enables input and focus. While you drive, a
  green frame marks the stream as yours; "Hand back" returns it to the bot,
  and so do two minutes with no key or pointer input from you
  (`OWNER_IDLE_MS` in `packages/sandbox/src/live-sessions.ts`). On a Mac, Cmd
  shortcuts are sent as Ctrl shortcuts to the remote Linux Chrome.
- **Clipboard.** Text copied in the remote Chrome lands on your clipboard.
  "Paste" (or Cmd+V on a Mac while driving) sends your clipboard to the remote
  one and presses Ctrl+V.
- **Reconnects** with backoff (1, 3, 5, 10, 20, 30 s) when the socket drops.
  Reset closes the browser, wipes the profile and returns to "Open browser".

Without a VNC display (local fallback, no `SANDBOX_HOST`) the panel shows
"No live view for this browser" with the current URL, and taking control,
Paste and Full screen are not offered.

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
  page's own resize route, view-only until you click it to take control.
  Taking control is the same driver flag the panel flips: every bot on that
  browser waits until you hand it back. One bar over the view holds the tabs,
  a status chip and the tools, so full screen keeps them on screen. **Paste**, **Full screen** (with keyboard lock) and
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
  (`checkPublicUrl`); `BROWSER_ALLOWED_PRIVATE_HOSTS` exempts named hosts and
  addresses. The guard (`navigation-guard.ts`) checks every main-frame request
  of a tab while an agent holds it, before the request is sent: the URL, each
  redirect hop, and what the page does later on its own (a meta refresh, a
  script setting `location`, a click). Popups such a tab opens are guarded the
  same way. A refused request never leaves the browser. Once no agent holds a
  tab (it switched away, handed back, or `closeTab` blanked the first tab),
  the guard lets the tab and its popups through again; the next agent action
  on it guards it again.
- Behind the guard, all of Chrome's traffic goes through a proxy on its own
  loopback (ADR 0038): `egress-proxy.ts` in the server for the local
  transport, `egress-proxy-vm.ts` started next to Chrome on the VM. It
  resolves each name once, refuses any private, loopback, link-local or
  metadata answer that is not exempt, and connects to the exact address it
  checked, so DNS rebinding has no second lookup to fool. It covers
  subframes, subresources, `fetch` and WebSockets, and the owner's tabs too:
  in the live view a private or tailnet address opens only when it is in
  `BROWSER_ALLOWED_PRIVATE_HOSTS`.
- On the local transport, where Chrome's proxy uses the server's resolver,
  the guard also refuses a name that resolves to a private address, unless
  the name or that address is exempt. On the VM transport the guard checks
  literals and local names only, and the VM-side proxy checks what names
  resolve to there (VM-only names such as `http://router/`, split-horizon or
  Docker-only names). A name that does not resolve on the server, or not
  within 3 seconds, is refused. Guarding a tab asks the browser process for
  the tab's id; when it doesn't answer within 5 seconds, the agent's action
  fails with "The browser tab is not responding" rather than hanging.
- On the VM, a refused tunnel and an unreachable site look the same to
  Chrome, so `navigate` says the proxy "refused or couldn't reach" the site.
- Every main-frame document load in the browser pauses for one DevTools round
  trip while the guard decides, in the owner's tabs too (they are continued
  at once). On the VM transport that round trip crosses the SSH tunnel.
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
`BROWSER_ALLOWED_PRIVATE_HOSTS`, `BROWSER_LOCALE` (default `en-IN`),
`BROWSER_TIMEZONE` (default `Asia/Kolkata`) (all optional; see `.env.schema`).

**Bot checks.** Sites behind AWS WAF (Amazon) or Cloudflare first answer a
browser they have not seen with a challenge page (an empty 202 on amazon.in)
whose script sets a token cookie and reloads. `browser_navigate` waits up to
15 s for that reload and returns the real page. Checks also compare what the
browser says with where its IP is, so Chrome reports `BROWSER_LOCALE` and
`BROWSER_TIMEZONE` rather than the VM's UTC and en-US, and the local headless
browser drops `navigator.webdriver` and the `HeadlessChrome` user agent. A
CAPTCHA is left for you to solve in the live view.

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
