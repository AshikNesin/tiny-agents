# Bot profiles (own browser and desktop)

A bot shares the owner's browser and desktop by default. Switched to its own browser profile in the bot settings, it gets a Chrome and an XFCE desktop of its own on the sandbox, with separate sign-ins and settings. The owner opens them from the chat's Browser and Computer panels (or the Browser and Computer pages, where they show as the bot's `own browser` / `own desktop` tab), watches them live, takes control, and resets either one, which closes it and wipes its profile. Deleting the bot closes its own browser and wipes that profile.

## Sub-features

- `profile-setting` bot settings → `Tools` → `Browser` group → radiogroup `Browser profile`: `Shared` (`Signed in where your other bots are.`) / `Own` (`A browser of its own, with separate sign-ins.`); `Save changes` → toast `Bot updated`; persists across a reload.
- `own-browser-open` chat Browser panel (`browser-toggle`) on a closed own browser: `No browser is open.` → `Open browser` → live view of the bot's own Chrome, `browser-driver` = `<bot> drives`.
- `own-browser-page` the panel's `Open in the Browser page` links to `/browser?profile=bot-<id>`, where tab `browser-tab-bot-<id>` (`own browser`) is selected and live.
- `own-browser-reset` panel `Reset browser profile` → alertdialog `Reset this bot's browser?` (`This closes the browser and deletes its cookies and logins.`) → `Reset`; toast `Browser profile wiped; the next session starts fresh.`; `Open browser` returns.
- `own-desktop-open` chat Computer panel (`computer-toggle`): `The computer is off.` → `Open computer` → the bot's own desktop live; `Take control` / `Release control` flip `computer-driver`.
- `own-desktop-page` `/computer` lists tab `computer-tab-bot-<id>` (`own desktop`); selecting it streams that desktop.
- `own-desktop-reset` panel `Reset computer` → alertdialog `Reset this bot's computer?` → `Reset`; toast `Computer reset; the next session starts a fresh desktop.`; `Open computer` returns.
- `own-delete` bot settings → `Delete bot` (twice): its own browser closes and its profile is wiped; and so does its own desktop (regression check for #173).
- Not driven: the bot itself using its own browser or desktop (`/browse N` works the same as on the shared profile, see `browser.md`; `computer_*` tools need a real model), Paste, full screen, switching an own-profile bot back to Shared.

## How to get to it (user POV)

- Chat header `Edit <bot>` (or the sidebar row's `Edit bot`) → `Tools` tab → expand `Browser` → `Browser profile`.
- In that bot's chat: header `Open browser panel` / `Open computer panel`, then `Open browser` / `Open computer`.
- Sidebar `Browser` / `Computer` pages: the bot's own tab.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox`, doctor OK; journey requires `sandbox`. One `--sandbox` run at a time.

- **Setup.** `setup:` a faux bot `Verify Own Profile <stamp>` on the default profile (`POST /api/v1/bots`, `modelId: "test-model"`); `GET /bots/<id>/browser` and `/computer` say `profile: "shared"`. One cleanup resets whatever of its own is still active, deletes the bot if it still exists, then kills a desktop recorded in its VM profile (`.desktop-pids`) and removes `~/data/browser-profiles/bot-<id>` and `~/.tiny-agents/computer-profiles/bot-<id>`: this drive's directories only.
- **Setting.** `Edit <bot>` → `Tools` → button `Browser N tools…` (expand) → radio `Shared` checked → `Own` → `Save changes` → `Bot updated`. Second view: `GET /bots/<id>` has `browserProfile: "own"`, both status routes say `profile: "own"`, `GET /browser` and `GET /computer` list `bot-<id>` inactive; after a reload the dialog shows `Own` checked.
- **Own browser.** `browser-toggle` → `Open browser`: `POST /bots/<id>/browser/start` 200, the panel reads `Live`, a WebSocket to `/bots/<id>/browser/vnc` sends `RFB ` + >20 KB. Not Shared: status `{active: true, profile: "own", mode: "vnc"}`, `GET /browser` has `bot-<id>` active and `shared` inactive, the page link is `/browser?profile=bot-<id>`, and on the VM Chrome runs with `--user-data-dir=…/browser-profiles/bot-<id>` and none with `…/shared`. The link opens `/browser?profile=bot-<id>`: tab selected, `own browser`, `Live`, socket `/browser/bot-<id>/vnc` streams.
- **Browser reset.** Back in the chat: `Reset browser profile` → `Reset this bot's browser?` → `Reset`: `DELETE /bots/<id>/browser/profile` 200, toast, `Open browser` back, status inactive, no Chrome for that profile and its directory gone on the VM.
- **Own desktop.** `computer-toggle` → `Open computer`: `POST /bots/<id>/computer/start` 200, socket `/bots/<id>/computer/vnc` streams, `Live`. Not Shared: status `{active: true, profile: "own"}`, `GET /computer` has `bot-<id>` active and `shared` inactive, `~/.tiny-agents/computer-profiles/bot-<id>/.desktop-env` exists and `wmctrl -l` under it lists windows; no shared desktop env. `Take control` → `You drive` (API `driver: "human"`) → `Release control`. `/computer` → tab `computer-tab-bot-<id>` (`own desktop`) → socket `/computer/bot-<id>/vnc` streams, view-only hint.
- **Desktop reset.** Chat → `Reset computer` → `Reset this bot's computer?` → `Reset`: `DELETE /bots/<id>/computer/profile` 200, toast, `Open computer` back, status inactive, profile directory gone, no `Xtigervnc` left.
- **Delete.** Open both again (status `active: true`), then `Edit <bot>` → `Delete bot` → confirm `Delete <bot>? This cannot be undone.` → `Delete bot`: `GET /bots/<id>` 404; Chrome for `bot-<id>` gone and its directory wiped; regression check for #173: `GET /computer` no longer lists `bot-<id>`, no `Xtigervnc` left, desktop profile directory gone.
- **Proof.** `ta-verify drive $S/journeys/bot-profiles.mjs` → `bot-profiles/settings-own`, `browser-own-live`, `browser-page-own-tab`, `browser-own-reset`, `computer-own-live`, `computer-page-own-tab`, `computer-own-reset`, `bot-deleted` (and `bug-1` while the bug is open).

## Gotchas

- Regression check for #173 (fixed 2026-11): deleting a bot with its own profile used to close and wipe its browser (#88) but leave its desktop running (`Xtigervnc`, XFCE) until the idle close and its desktop profile on the sandbox. `deleteBot` now releases both; the last step asserts it.
- `Browser profile` is a radiogroup (`radio` + `aria-checked`), not a toggle-button group. It shows only when the `Browser` group is expanded and the tool search is empty.
- The Computer panel's `Open the Computer page` always goes to `/computer` (no profile in the URL, unlike the Browser panel's link), and the page selects the remembered or Shared tab: click the bot's tab.
- Only one live panel shows at a time in a chat; opening one puts it in front, so close or toggle rather than looking for both.
- VM read-backs with `pgrep -f` run inside `bash -c`, whose own command line holds the pattern: bracket the first character (`[X]tigervnc`).
- The browser profile lives under `~/data/browser-profiles/` on the VM (relative to the bots' user's home), the desktop under `~/.tiny-agents/computer-profiles/`.
- After a reset the live view's reconnect asks for a VNC ticket for a closed session: `result.json` `consoleErrors` then holds a `404` (`POST …/vnc-ticket`); expected.
