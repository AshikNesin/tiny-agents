# Vault step-up with a passkey

Before a vault write or reveal, `Confirm it's you` also offers `Use a passkey`: the owner confirms with a passkey of their own instead of their password and stays confirmed for five minutes (a later edit asks nothing). A passkey that is not the owner's (another person's on a shared device, a deleted one, or none on this device) is refused, the prompt stays open and the owner stays signed in.

## Sub-features

- `vault-pk-confirm` `Use a passkey` → the browser's passkey prompt → the pending reveal goes through (`POST /api/v1/vault/step-up/options`, then `POST /api/v1/vault/step-up` with the assertion, 200 with a token); the passkey shows a last-used time.
- `vault-pk-window` within the five minutes a value edit (`Edit` → dialog `<Field>` → `New value` → `Save`, sent as `PUT /api/v1/vault/items/<handle>`) asks nothing more.
- `vault-pk-someone-else` another account's passkey on the same device: toast `That passkey belongs to someone else` (403); prompt open, value masked, still signed in.
- `vault-pk-leftover` a passkey the server no longer knows (a removed guest's, still on the device): must be refused the same way. **Currently signs the owner out, see Gotchas.**
- `vault-pk-other-device` a device without the owner's passkey: the browser refuses (toast `The operation either timed out or was not allowed…`), nothing is sent to `/vault/step-up`; still signed in.

## How to get to it (user POV)

- Any vault write or reveal (e.g. an item's `Reveal` on `/vault/items/<handle>`) after a full page load → dialog `Confirm it's you` → `Use a passkey`.
- Passkeys are added under account menu → `Settings` → `Security` (`/settings/security`; a guest's Settings has only Appearance and Security).

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK. The journey signs in (login form) as a fresh owner `vault-owner-<stamp>@example.com` created with `adminKey` (`POST /api/v1/auth/users`), so the owner starts with no passkeys whatever ran before on the run.
- Setup (API): an API-key item `verify-pk-key-<stamp>` (password step-up), and a guest `vault-guest-<stamp>@example.com` (`POST /api/v1/people`) who signs in in a second browser context and adds a passkey on its own CDP virtual authenticator. That credential is copied (`WebAuthn.getCredentials` → `WebAuthn.addCredential`) into a virtual authenticator on the owner's page: one laptop holding both accounts' passkeys.

- **Someone else.** `/vault/items/<handle>` → `Reveal` → `Use a passkey`: the owner has no passkeys, so the browser offers the guest's. Step-up calls `options` 200, `step-up` 403; toast; dialog open, URL unchanged, `GET /api/v1/auth/me` is the owner; `Escape` closes the dialog on the item.
- **Leftover (regression check for #174).** Remove the guest (`DELETE /api/v1/people/<id>`; its passkeys go with it) and repeat: `step-up` is 401 `Passkey not found` (toast) and the owner stays on the item. Runs before the owner registers a passkey (afterwards the browser offers only the owner's).
- **Register.** Swap in a fresh authenticator; `Settings` → `Security` → `Name (optional)` `vault-pk-<stamp>` → `Add passkey` → toast; `GET /api/v1/passkey/list` has only it.
- **Confirm with it.** Reload the item, `Reveal` → `Use a passkey`: `options` 200 + `step-up` 200 (keep the token), dialog gone, the value shows in row `Key`; the passkey's `lastUsedAt` is set.
- **Same window.** `Hide`, `Edit` → `New value` → `Save`: `PUT` 200, `Key saved`, no step-up call; `POST /vault/items/<handle>/reveal` with the passkey's token returns the new value.
- **Other device.** Swap in an empty authenticator, reload, `Reveal` → `Use a passkey`: only `options` was called; the browser's not-allowed toast; dialog open, still signed in.
- **Proof.** `ta-verify drive $S/journeys/vault-passkey.mjs` → `vault-passkey/guest-passkey`, `step-up-prompt`, `someone-else-refused`, `leftover-refused`, `revealed-with-passkey`, `edited`, `other-device-refused`, plus `bug-N` per open bug. Cleanup purges the item and removes the guest.

## Gotchas

- Regression check for #174 (fixed 2026-11): `POST /vault/step-up` with a passkey the server does not know answers core's 401 `Passkey not found`, and the shell used to sign the owner out on any 401. It now signs out only on the session guard's 401 (`error.code` `SESSION_INVALID`). If it regresses, the journey records the bug step, signs in again and finishes the rest.
- Residue per drive: the fresh owner account and its passkey (owners cannot be deleted through the API, and the last passkey cannot be deleted). Harmless on a disposable run.
- With `allowCredentials` empty (an owner without passkeys) a virtual authenticator answers with any discoverable credential it holds for the RP; once the owner has a passkey, the browser offers only theirs, so the someone-else and leftover paths are reachable only before registering.
- Step-up costs auth attempts (options and verify both count, about 11 for the drive including the logins). `up` lifts the limit to 1000 (`AUTH_RATE_LIMIT_MAX`), so any run has budget.
- The item update path the UI uses is `PUT /vault/items/<handle>`; `PATCH /vault/items/<handle>` (one value) has no caller in the UI.
- Password step-up, masking, policy and delete are in `vault.mjs`; passkey add/rename/delete and passkey login in `passkeys.mjs`.
