# Computer

The owner watches and uses the bots' XFCE desktops on the sandbox from `/computer`: one tab per desktop (Shared, plus one per bot with its own profile), a live VNC view that is view-only until `Take control`, an Apps menu and a Keys menu while driving, full screen, and Reset. The same desktop opens beside a chat in the Computer panel. Bots on a desktop wait while the owner drives.

## Sub-features

- `computer-tabs` tablist `Desktops`: each tab names its desktop and who uses it (bot name, `N bots`, `own desktop`).
- `computer-start` `Start desktop` on an off desktop (`This desktop is off.`); first run on a fresh VM shows `Setting up the computer on the VM`.
- `computer-live` the VNC live view, view-only with the hint `View only · Take control to use it`.
- `computer-control` `Take control` / `Release control` (the driver flag bots wait on); Apps, Keys and Paste are disabled until you drive.
- `computer-apps` `Apps` menu (`Open an app`) launches an installed app; toast `Opening <app>…`.
- `computer-keys` `Keys` menu (`Send to the desktop`): Applications menu, Run a program, Open a terminal, Switch windows, Close window, Close tab, Escape, Super.
- `computer-fullscreen` `Full screen` / `Exit full screen`.
- `computer-reset` `Reset desktop` → alertdialog `Reset the <label> desktop?` → `Reset`; toast `Desktop reset; it starts fresh next time.`
- `computer-panel` the chat's `computer-toggle` opens the Computer panel (`Take control`, `Release control`, `Open the Computer page`, `Close computer panel`).
- Not driven: `Paste from your clipboard` (needs clipboard permission), a bot's `computer_*` tools and its takeover request (`Needs you`, "A bot asked you:"): the faux model cannot call `computer_*` tools, so the agent side and the takeover card are unreachable here.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Computer` (`/computer`).
- From a chat: header button `Open computer panel` (shown when the server has a sandbox).
- Without a sandbox the page shows `No computer on this server`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox`, doctor OK; journey requires `sandbox`. Only one `--sandbox` run at a time (one shared desktop).

- **Setup.** `setup:` `POST /api/v1/bots {name: "Verify Computer <stamp>", modelId: "test-model"}` (cleanup deletes it): gives the Shared tab a user and the chat panel a bot.
- **Open.** `/computer`: `computer-tab-shared` is `aria-selected=true` and contains the bot name; `GET /api/v1/computer` has `configured: true`.
- **Start.** `Start desktop` (if shown; register a cleanup that `DELETE /api/v1/computer/shared` while active). A WebSocket to `/api/v1/computer/shared/vnc` receives the `RFB ` banner and >20 KB of framebuffer; the view-only hint shows; `computer-apps`/`computer-keys` are disabled; `wmctrl -l` on the VM (sourcing `~/.tiny-agents/computer-profiles/shared/.desktop-env`) lists windows.
- **Take control.** `Release control` appears, Apps/Keys/Paste enable, API `driver: "human"`.
- **Apps.** `computer-apps` → menu `Open an app` → pick `Mousepad` (else the first item). Toast `Opening Mousepad…`; the VM's window count grows.
- **Keys.** `computer-keys` → menuitem `Open a terminal`: the socket sends ≥6 key events (RFB type 4, or QEMU extended type 255/0) and a new `terminal` window shows in `wmctrl -l -x`.
- **Release.** `Release control` → `Take control` back, Apps disabled, driver not `human`.
- **Full screen.** `document.fullscreenElement` is `computer-region`; leave via `exitFullscreen()`.
- **Chat panel.** `/chats/<botId>` → `computer-toggle`: `computer-panel` streams over `/api/v1/bots/<id>/computer/vnc`; `Take control` → `computer-driver` reads `You drive`; `Release control`; `Close computer panel`.
- **Reset.** `/computer` → `Reset desktop` → `Reset the Shared desktop?` → `Reset`: toast, `Start desktop` returns, API `active: false`, no `Xtigervnc` left on the VM.
- **Proof.** `ta-verify drive $S/journeys/computer.mjs` → `computer/open`, `live-view-only`, `app-opened`, `keys-terminal`, `chat-panel`, `reset`.

## Gotchas

- The view is a canvas. Prove it through the VNC socket (banner + bytes, key events sent) and VM read-backs, not pixels; the screenshots are supporting evidence only.
- noVNC sends keys as QEMU extended key events to TigerVNC (type 255), not plain RFB KeyEvent; count both.
- The desktop is shared with the browser's display lock; reset at the end so the next drive starts from `This desktop is off.` A cold desktop takes ~10–30 s to start.
- Headless Chromium ignores Esc for full screen; leave with `exitFullscreen()`.
- HARNESS BUG (open): `lib.mjs` silences Vite HMR with `context.routeWebSocket`, which swaps in Playwright's WebSocket mock for every socket in the page. noVNC then receives the RFB banner but never reaches `Live` (status stays `Reconnecting`), so this journey fails at the live-view step until the stub is replaced (stubbing `/@vite/client` with `context.route` keeps noVNC working). Passing runs from before the stub: `sbx-3` (computer), `sbx-1` (browser).
