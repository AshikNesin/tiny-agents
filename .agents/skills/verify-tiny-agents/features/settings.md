# App settings

A user manages key/value app settings on `/settings`: add a key, give it a description and a JSON value in a code editor, save, see it again after a reload, and delete it after confirming.

## Sub-features

- `settings-create` adds a key from `Add setting` and selects it.
- `settings-edit` edits Description and the JSON value; `Save changes` shows `updated successfully`.
- `settings-persist` shows the saved values after a full reload.
- `settings-delete` deletes through an alert dialog and clears the selection.

## How to get to it (user POV)

- Sidebar button `Account and navigation` → menuitem `Settings` (`/settings`, which opens Account) → `Configuration` (`/settings/configuration`); also the ⌘K palette (`Search`).

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. No key `verify.setting.<stamp>`.

- **Create.** `Add setting`, fill the field with placeholder matching `featureFlags`, press `Create`. Heading with the key appears.
- **Edit.** Fill `Description`; click the CodeMirror editor (`.cm-content`, the one non-ARIA handle), select all, type `{"enabled": true}`; `Save changes`. Text `updated successfully`.
- **Persist.** Reload, click the button named with the key. `Description` has the value; the editor contains `"enabled": true`; `GET /api/v1/settings/<key>` is 200 with it.
- **Delete.** `Delete`, then `Delete` inside the `alertdialog`. Text `No setting selected`; no button with the key; API returns 404.
- **Proof.** `ta-verify drive $S/journeys/settings.mjs` → `settings/persisted`, `settings/deleted`.

## Gotchas

- The JSON editor is CodeMirror; `fill()` does not work on it. Click, select all with `ControlOrMeta+a`, then type.
- Keys are global to the instance; stamp them.
