# Browser

The bots browse in a real Chrome on the sandbox, and the owner sees it live. `/browser` shows each browser (Shared, plus one per bot with its own profile) with a live view that is view-only until you click it (`Take control`), full screen and Reset in the view's own bar. In a chat, the Browser panel never opens by itself: browsing lights the header toggle, which opens it. The panel can shrink to a floating picture in picture (remembered). On a phone the docked panel covers the screen.

## Sub-features

- `browser-page-tabs` tablist `Browsers`: Shared (names its bots) and `own browser` tabs; the choice is remembered; `/browser?profile=bot-<id>` selects one.
- `browser-page-open` `Open browser` on a closed browser opens Chrome and the owner's own tab.
- `browser-page-live` live view, status chip `<bot> is driving` / `Bots are driving` (`browser-page-status`), the stream is the `Take control` button.
- `browser-page-control` a click on the stream (`Take control`: `You're driving`, Paste shows, a green frame) / `Hand back`.
- `browser-page-fullscreen` `Full screen` / `Exit full screen`.
- `browser-page-reset` `Reset browser` → alertdialog `Reset the Shared browser?` naming the bots it signs out → `Reset`; toast `Browser reset; it starts fresh next time.`
- `browser-panel-closed` `/browse N` in a chat leaves the panel (`browser-panel`) closed and lights `live-view-toggle`, which opens it live beside the chat.
- `browser-panel-control` a click on the panel's stream takes control (the layer is `Take control`, `browser-takeover`), `Hand back` returns it (`browser-driver`), `Open in the Browser page` link.
- `browser-pip` `Picture in picture` floats it small (`data-layout=pip`) over the chat; the toggle reopens it that way, also after a reload; `Expand live view` docks it.
- `browser-panel-phone` at 390x844 the picture in picture floats over the chat; docked, the panel is a full-screen overlay.
- Not driven: Paste (clipboard permission), the panel's Reset (same route as the page's), the drag-to-resize separator, typing secrets.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Browser` (`/browser`).
- In a chat: header `Open live view` (`live-view-toggle`; with a computer, then tab `Browser`), or let the bot browse.
- Without a sandbox bots browse headless and the page says `No live browser on this server`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox`, doctor OK; journey requires `sandbox`. One `--sandbox` run at a time.

- **Setup.** `setup:` two faux bots via `POST /api/v1/bots` (`modelId: "test-model"`): `Verify Browser <stamp>` (shared) and `Verify Own <stamp>` with `browserProfile: "own"`; cleanups delete both.
- **Page tabs.** `/browser`: `browser-tab-shared` selected and contains the shared bot's name; `browser-tab-bot-<ownId>` says `own browser`. `/browser?profile=bot-<ownId>` selects it; click Shared back.
- **Open.** `Open browser` (register a cleanup that resets `shared` if still active). `browser-page-driver` shows (≤120 s cold); a WebSocket to `/api/v1/browser/shared/vnc` receives `RFB ` + >20 KB; the stream's `Take control` layer shows; `GET /api/v1/browser` has `active: true`; Chrome runs in the container (`pgrep`).
- **Control.** `Take control` (exact, the stream) → `Hand back`, status `You're driving`, Paste enabled, API `driver: "human"`. `Hand back` → status `<bot> is driving`.
- **Full screen.** `document.fullscreenElement` is `browser-region`; leave via `exitFullscreen()`.
- **Panel, desktop (1280 wide).** `/chats/<botId>`, send `/browse 2`: one `^Echo:` and no panel. Click `live-view-toggle`: `browser-panel` streams over `/api/v1/bots/<id>/browser/vnc`; `browser-driver` = `<bot> is driving`. Click the stream (`Take control`) → `You're driving` (API agrees) → `Hand back`. `Picture in picture` → `data-layout=pip`, at most 320 px wide, composer visible; `/browse 1` while it floats. Toggle off and on: still pip. `Expand live view` docks it (`Open in the Browser page`); back to pip.
- **Panel, phone (390x844).** Close; `/browse 1` leaves it closed; reload; the toggle opens it as pip, Live, narrower than the phone, composer visible. `browser-pip-expand` makes it the full-viewport overlay.
- **Reset.** `/browser` (1280 wide) → `Reset browser` → dialog names `Every bot on it is signed out (<bot>)` → `Reset`: toast, `Open browser` returns, API `active: false`, no Chrome left on the VM.
- **Proof.** `ta-verify drive $S/journeys/browser.mjs` → `browser/page-live`, `page-you-drive`, `panel-closed-in-use`, `panel-desktop`, `pip-desktop`, `pip-phone`, `panel-phone`, `page-reset`.

## Gotchas

- The faux model reads the page with `browser_snapshot` only (`/browse N`, up to 10 rounds); clicking, typing and navigating are out of its reach, so the agent-driven actions are not verified here.
- At widths below 1280 (xl) the open panel overlays the chat and covers `Start a new chat`: close it before using the chat header.
- The header toggle is `Open live view` / `Close live view`; `Close browser panel` is only the panel's own button, and it closes the whole live view.
- The final echo repeats the last snapshot, so count `^Echo:` texts rather than matching their content.
- Opening from the page first creates the owner's tab; the bot then gets a tab of its own (two tabs in the live view is expected).
- Headless Chromium ignores Esc for full screen; leave with `exitFullscreen()`.
- Never use `context.routeWebSocket` in a journey: any WebSocket route makes Playwright proxy every socket in the page, and noVNC then stays `Reconnecting`. `lib.mjs` silences Vite HMR by serving a no-op `/@vite/client` instead.
