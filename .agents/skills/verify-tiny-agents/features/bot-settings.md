# Bot settings

A user manages a bot from its chat header or its sidebar row. The `Edit <bot>` dialog has Profile, Tools, Skills and Sharing tabs; on Profile they change the name, description, model and system prompt, and a name another bot already has is refused under the Name field. The sidebar row's actions menu pins and unpins the bot, opens the same editor, and opens Chat history. Deleting the bot asks for an inline confirmation and removes it from the sidebar.

## Sub-features

- `bot-edit-open` the header's bot name `<bot> menu` → `Bot settings` opens dialog `Edit <bot>` with tabs `Profile`, `Tools`, `Skills`, `Sharing` (Profile selected).
- `bot-edit-taken-name` saving a name another bot has keeps the dialog open, marks `Name` `aria-invalid=true` and shows the error under it; nothing is saved.
- `bot-edit-profile` `Name`, `Description`, `System prompt`, `Save changes`: toast `Bot updated`; header, composer placeholder and sidebar row follow the new name; the description shows atop the bot menu and in the empty chat.
- `bot-edit-persist` the saved values come back in the dialog after a reload and in `GET /api/v1/bots/<id>`.
- `bot-pin` row menu `Pin`: the bot moves under a `Pinned` group (`pinnedAt` set); `Unpin` moves it back.
- `bot-row-edit` row menu `Edit bot` opens the same dialog.
- `bot-delete` `Delete bot` → inline `Delete <bot>? This cannot be undone.` → `Delete bot`: dialog closes, the row is gone, the URL leaves the bot, the API no longer lists it.

## How to get to it (user POV)

- In a bot's chat: the bot's name in the header (`<bot> menu`) → `Bot settings`.
- Sidebar region `Bots`: hover the bot's row → `<bot> actions` → `Pin`/`Unpin`, `Edit bot`, `Chat history`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. Two bots of the journey's own (`setup:` via the API): the one under test and one whose name is "taken".

- **Open.** `<bot> menu` → `Bot settings` in the header; dialog `Edit <bot>`, four tabs, Profile selected, `Name` holds the name.
- **Taken name.** Fill `Name` with the other bot's name, `Save changes`: `Name` gets `aria-invalid=true`, `A bot named "<other>" already exists` shows under it; the API still has the old name.
- **Save.** Fill `Name`, `Description`, `System prompt`; `Save changes`. Toast `Bot updated`; `<new name> menu`, placeholder `Message <new name>`, the sidebar row; the description appears once in the empty chat and atop the bot menu; `GET /api/v1/bots/<id>` matches.
- **Reload.** Reopen the dialog: all three fields hold the saved values. `Cancel`.
- **Pin/Unpin.** Hover the row, `<bot> actions` → `Pin`: text `Pinned` in the Bots region and `pinnedAt` set. Again → `Unpin`: gone, `pinnedAt` null.
- **Edit from the row.** `<bot> actions` → `Edit bot`: the dialog shows the saved description.
- **Delete.** `Delete bot`, check the confirmation text, `Delete bot`. The row is gone, URL no longer has the id, not in `GET /api/v1/bots`.
- **Proof.** `ta-verify drive $S/journeys/bot-settings.mjs` → `bot-settings/edit-open`, `name-taken`, `saved`, `pinned`, `delete-confirm`, `deleted`.

## Gotchas

- Bot names are unique; the 409 shows under `Name` (switching to Profile), not as a toast.
- The row actions button is only visible on hover/focus: hover the row first.
- The faux catalog has one model (`Test Model (faux)`), so switching models (Model selector, or the composer's model chip) can't be shown changing anything here.
- The Tools tab (tool permissions) is covered by `tool-permissions.mjs`; Skills and Sharing need skills and guest users set up and are not driven here.
- On a phone-width viewport `Delete bot` moves from the footer to the bottom of the Profile tab.
