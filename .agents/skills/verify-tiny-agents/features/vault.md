# Vault

A user keeps the secrets bots may use (logins, cards, contacts, API keys) on `/vault`. Bots only ever see a handle. The page shows the backends (Local, encrypted with `SECRETS_KEY`; 1Password when configured), lists items by kind, and creates, edits, reveals, copies, unlinks, re-links and deletes them. Every write or reveal first asks the owner to confirm their password (step-up, valid 5 minutes, held in page memory only). Values stay masked unless revealed and never appear in page HTML, list or detail API reads, or the server log.

## Sub-features

- `vault-backends`: card `Local` (Ready, `Encrypted with SECRETS_KEY`) and `1Password` (`Not set up`, with its env hint).
- `vault-new` (`New item` → dialog `New item`, `Saved in Local` → `Login` / `Card` / `Contact` / `API key` → `/vault/new/<kind>`, heading `New <kind>`): Name, kind fields (secret ones masked with `Show`, passwords with `Generate a password`), handle suggested from the name, policy (`Fills only on` / `Sent only to`, `Approval`, `Use in routines`, `Bots`, `Tools`, `When to use`).
- `vault-step-up`: dialog `Confirm it's you` (Password or `Use a passkey`) before the first write/reveal; a full page load forgets it.
- `vault-detail` (`/vault/items/<handle>`): Values (secrets `••••••••••`, username and card expiry in clear), `Reveal`/`Hide` (auto-hides after 30 s), `Copy` (clipboard, cleared after 30 s), `Edit` → dialog `<Field>` → `New value`, `+ <Field>` for empty fields, Activity trail (`created · vault_ui`, `updated`, `revealed`, …).
- `vault-policy`: `Save` the policy form; switch `Let bots use this item` (On/Off; list shows `off`). Cards: `Approval` locked to every use, `Use in routines` disabled.
- `vault-list`: sections `Logins`, `Cards` (brand `••last4`, never the number), `Contacts`, `API keys`, plus `Not linked yet` with `Link`.
- `vault-delete`: dialog `Delete “<title>”?` → `Unlink only` (moves to `Not linked yet`; `Link` → dialog `Let bots use “<title>”` gives it a handle again) or `Delete everywhere`.
- `vault-request` (`/vault/requests/<taskId>`): the credential-request sheet a bot opens with `request_credentials`; a request that is not open shows `Nothing to fill`.

## How to get to it (user POV)

- Sidebar button `Account and navigation` → menuitem `Vault` (`/vault`); also the ⌘K palette.
- An item: its row link in the list. A credential request: the card in the bot's chat.

## Driving it with ta-verify

Preconditions:

- Baseline run (every run sets a random `SECRETS_KEY`, so the Local backend is writable), doctor OK, signed in. No handles `verify-{key,login,card,contact}-<stamp>`.
- Stay in the SPA (account menu, in-page links): `page.goto`/`reload` drops the step-up token and the next write asks again.

- **Backends.** Account menu → `Vault`: `Encrypted with SECRETS_KEY`, `Not set up`, `New item` enabled.
- **API key.** `New item` → `API key`; Name `Verify key <stamp>` → `Handle` becomes `verify-key-<stamp>`; `Key` (`type=password`); `Sent only to` `api.example.com`; `Save` → `Confirm it's you` → demo password → `Confirm` (capture the token from the `/vault/step-up` response for API read-backs and cleanup) → `Saved`, `/vault/items/<handle>`.
- **Masked + stored.** Row `Key` shows `••••••••••`; Activity `created · vault_ui`; the key is in neither the page HTML, `GET /vault/items/<handle>` (which lists `fields: ["value"]`) nor `GET /vault`; `POST /vault/items/<handle>/reveal` with `X-Vault-Step-Up` returns it.
- **Reveal / Copy / Edit.** `Reveal` shows it, `Hide` masks it. With clipboard permissions, `Copy` → toast `Key copied; …`, clipboard holds it. `Edit` → `New value` (masked) → `Save` → `Key saved`; the API reveal returns the new value; Activity has `updated`.
- **Policy.** Fill `When to use`, `Save`; reload; value back (and in the API). Switch `Let bots use this item` → step-up again (the reload dropped it) → `Off`; API `disabled: true`; list row contains `off`.
- **Login.** `Login`: Name, `Website` `https://login.example.com/signin`, Username, `Generate a password`; Save (no prompt: still confirmed). Username in clear, `Password` masked; origins `["https://login.example.com"]`; API reveal = generated password; it is not in the page.
- **Card.** `Card`: number `4242424242424242`, Expiry `12/2030`, Security code, Name on card; `Cards always ask, every time.`, `Use in routines` disabled. Detail masks the number; `approval: "every_use"`; the list row shows `••4242` and the list HTML has no full number.
- **Contact.** `Contact`: Name, `Email` textbox (exact) → section `Contacts` lists it.
- **Unlink + Link.** Login → `Delete` → `Unlink only` → `Unlinked`, `/vault`, section `Not linked yet` lists it as `Login` → `Link` → dialog `Let bots use “<title>”` (handle prefilled) → `Link` → back on the item, value intact.
- **Delete everywhere.** API key → `Delete` → `Delete everywhere` → `Deleted`; `GET /vault/items/<handle>` 404 and not under `unlinked`.
- **Request page.** `/vault/requests/999999` → heading `Credential request`, `Nothing to fill`.
- **Server log.** `data/verify/<run>/server.log` contains none of the values.
- **Wrong step-up password.** Reload an item, `Reveal`, wrong password → toast `Wrong password`; the dialog must stay open on the item. **Fails today, see Gotchas.**
- **Proof.** `ta-verify drive $S/journeys/vault.mjs` → `vault/backends`, `step-up`, `api-key-masked`, `api-key-revealed`, `login`, `list-by-kind`, `unlinked`, `deleted`, `request-closed`, `step-up-refused`.

## Gotchas

- **Product bug:** a wrong step-up password signs the owner out. `/vault/step-up` answers 401 `Wrong password`, and the shell's global 401 handler (`packages/shell/src/store/auth.ts`) treats any 401 as an expired session: the app jumps to `/login` and unsaved vault edits are lost. The journey's last step asserts the correct behaviour (dialog stays open) and fails until that is fixed.
- Step-up calls count toward the auth rate limit (20 per 15 min per instance) like logins.
- Toasts stack (`Saved`, `Key saved`, `Key copied…`); assert the stored state rather than a toast that may be hidden under newer ones.
- The contact form has two `Name` fields (item name and the contact's name) and the feedback widget has its own `Email (optional)`; use `exact` names / `first()`.
- A real credential request needs a bot calling `request_credentials` on a live browser page (sandbox VM, `up --sandbox`, plus a model that calls the tool): unreachable with the faux model. Bot use of a vault item (`browser_fill_secret`, `http_request`, `vault_list`, approval cards) needs a real model too. 1Password needs `OP_CONNECT_*` and a Connect server: unreachable. Passkey step-up needs a registered passkey: not driven.
