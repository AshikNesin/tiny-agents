# Browser

The bots browse in a real Chrome on the sandbox, and the owner sees it live. `/browser` shows each browser (Shared, plus one per bot with its own profile) with a live view that is view-only until `Take control`, full screen and Reset. In a chat, the Browser panel opens by itself the first time the bot uses the browser in that conversation; once the owner closes it, it stays closed for that conversation (later browsing only lights the header toggle). On a phone the panel covers the screen.

## Sub-features

- `browser-page-tabs` tablist `Browsers`: Shared (names its bots) and `own browser` tabs; the choice is remembered; `/browser?profile=bot-<id>` selects one.
- `browser-page-open` `Open browser` on a closed browser opens Chrome and the owner's own tab.
- `browser-page-live` live view, status line `Live · <bot> drives` (`browser-page-status`), view-only hint.
- `browser-page-control` `Take control` (`You drive`, Paste enabled) / `Release control`.
- `browser-page-fullscreen` `Full screen` / `Exit full screen`.
- `browser-page-reset` `Reset browser` → alertdialog `Reset the Shared browser?` naming the bots it signs out → `Reset`; toast `Browser reset; it starts fresh next time.`
- `browser-panel-auto` `/browse N` in a chat opens the panel (`browser-panel`) live beside the chat.
- `browser-panel-control` panel `Take control` / `Release control` (`browser-driver`), `Open in the Browser page` link.
- `browser-panel-close-sticks` after `Close browser panel`, further `/browse` runs, and a reload, leave it closed; `browser-toggle` reopens it; a New chat starts fresh.
- `browser-panel-phone` at 390x844 the panel is a full-screen overlay.
- Not driven: Paste (clipboard permission), the panel's Reset (same route as the page's), the drag-to-resize separator, typing secrets.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Browser` (`/browser`).
- In a chat: header `Open browser panel` (`browser-toggle`), or let the bot browse.
- Without a sandbox bots browse headless and the page says `No live browser on this server`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox`, doctor OK; journey requires `sandbox`. One `--sandbox` run at a time.

- **Setup.** `setup:` two faux bots via `POST /api/v1/bots` (`modelId: "test-model"`): `Verify Browser <stamp>` (shared) and `Verify Own <stamp>` with `browserProfile: "own"`; cleanups delete both.
- **Page tabs.** `/browser`: `browser-tab-shared` selected and contains the shared bot's name; `browser-tab-bot-<ownId>` says `own browser`. `/browser?profile=bot-<ownId>` selects it; click Shared back.
- **Open.** `Open browser` (register a cleanup that resets `shared` if still active). `browser-page-status` reads `Live` (≤120 s cold); a WebSocket to `/api/v1/browser/shared/vnc` receives `RFB ` + >20 KB; the view-only hint shows; `GET /api/v1/browser` has `active: true`; Chrome runs in the container (`pgrep`).
- **Control.** `Take control` (exact) → `Release control`, status `You drive`, Paste enabled, API `driver: "human"`. `Release control` → status `<bot> drives`.
- **Full screen.** `document.fullscreenElement` is `browser-region`; leave via `exitFullscreen()`.
- **Panel, desktop (1280 wide).** `/chats/<botId>`, send `/browse 2`: `browser-panel` appears, says `Live`, streams over `/api/v1/bots/<id>/browser/vnc`; one `^Echo:` text when done; `browser-driver` = `<bot> drives`. `Take control` → `You drive` (API agrees) → `Release control`. Close; `/browse 1` → 2 echoes, panel still closed; `browser-toggle` opens it with `Open in the Browser page`; close it again.
- **Panel, phone (390x844).** `Start a new chat` → `New chat`; `/browse 1` opens the panel at the full viewport size. Close; `/browse 1`; reload: still closed (2 echoes); `browser-toggle` opens it.
- **Reset.** `/browser` (1280 wide) → `Reset browser` → dialog names `Every bot on it is signed out (<bot>)` → `Reset`: toast, `Open browser` returns, API `active: false`, no Chrome left on the VM.
- **Proof.** `ta-verify drive $S/journeys/browser.mjs` → `browser/page-live`, `page-you-drive`, `panel-desktop`, `panel-phone`, `panel-phone-reopened`, `page-reset`.

## Gotchas

- The faux model reads the page with `browser_snapshot` only (`/browse N`, up to 10 rounds); clicking, typing and navigating are out of its reach, so the agent-driven actions are not verified here.
- At widths below 1280 (xl) the open panel overlays the chat and covers `Start a new chat`: close it before using the chat header.
- `Close browser panel` is both the header toggle's name (when open) and the panel's own button; scope to `browser-panel`.
- The final echo repeats the last snapshot, so count `^Echo:` texts rather than matching their content.
- Opening from the page first creates the owner's tab; the bot then gets a tab of its own (two tabs in the live view is expected).
- Headless Chromium ignores Esc for full screen; leave with `exitFullscreen()`.
- Never use `context.routeWebSocket` in a journey: any WebSocket route makes Playwright proxy every socket in the page, and noVNC then stays `Reconnecting`. `lib.mjs` silences Vite HMR by serving a no-op `/@vite/client` instead.
