# Passkeys

A signed-in owner adds passkeys under Settings → Security (optionally named), sees each with its kind, added and last-used dates, renames and deletes them (the last one cannot be deleted), and can then sign in from the login page with `Sign in with passkey` instead of a password.

## Sub-features

- `passkey-add` registers a passkey on this device (`Add passkey`, toast `Passkey added successfully`), listed as `Device-bound passkey` with `Added <date>`.
- `passkey-same-device` refuses a second passkey from the same authenticator with toast `Unable to add passkey`.
- `passkey-rename` renames through the `Edit passkey name` dialog.
- `passkey-delete` deletes after the `Delete passkey` confirmation.
- `passkey-last-guard` disables `Delete` on the only remaining passkey (`canDelete: false`).
- `passkey-login` signs in with `Sign in with passkey` and returns to the page the session ended on; the passkey then shows `Last used <date>`.

## How to get to it (user POV)

- Account menu (`Account and navigation`) → `Settings` → tab `Security`.
- Sign in: `/login` → `Sign in with passkey`.

## Driving it with ta-verify

Preconditions:

- Baseline run (it sets `RP_ID=localhost`, `ORIGIN=http://localhost:<port>`), doctor OK, signed in as demo.
- A Chromium virtual authenticator from CDP: `const cdp = await context.newCDPSession(page); await cdp.send("WebAuthn.enable"); await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })`. A second "device" is a second virtual authenticator (`removeVirtualAuthenticator` the first).

- **Open.** Account menu → `Settings` (URL `/settings`) → tab `Security`: headings `Add a passkey`, `Your passkeys`.
- **Add (device A).** `Name (optional)` = `verify-key-<stamp>-a`, `Add passkey`. Toast; list item with the name, `Device-bound passkey`, `Added …`; the field clears.
- **Same device.** Add `…-dup` again on device A: toast `Unable to add passkey`; `GET /api/v1/passkey/list` still has only `-a`.
- **Add (device B).** Switch authenticators, add `verify-key-<stamp>-b`. API lists both.
- **Rename.** On `-a`: `Edit` → dialog `Edit passkey name`, `Passkey name` prefilled → `verify-key-<stamp>-renamed` → `Save`. Toast `Passkey name updated successfully`.
- **Delete.** On the renamed one: `Delete` → alertdialog naming it → `Delete`. Toast `Passkey deleted successfully`; API lists only `-b`.
- **Guard.** Reload, tab `Security`: `-b` listed; when it is the user's only passkey its `Delete` is disabled and the API says `canDelete: false`.
- **Passkey login.** Account menu → `Log out` → `/login` → `Sign in with passkey`. URL `/settings` (where the session ended), heading `Settings`; `GET /api/v1/auth/me` is the demo email. Tab `Security`: `-b` shows `Last used …`; API `lastUsedAt` set.
- **Proof.** `ta-verify drive $S/journeys/passkeys.mjs` → `passkeys/security-tab`, `passkeys/two-passkeys`, `passkeys/last-passkey-guard`, `passkeys/signed-in-with-passkey`.

## Gotchas

- Residue: the demo user's last passkey cannot be deleted (product rule, API refuses too), so each drive leaves one `verify-key-<stamp>-b` on the run. Password login is unaffected; a second drive on the same run skips the "only passkey" check because more than one exists.
- A virtual authenticator refuses to register the same user twice (the server sends the existing credential in `excludeCredentials`); use a second authenticator for a second passkey.
- Login (password or passkey) returns to the page the session ended on, so after logging out of `/settings` a passkey sign-in lands on `/settings`, not `/chats`.
- Passkey login options and verify both count against the 20-per-15-minutes auth limit.
- `Add a passkey` is also a substring of the empty-state text; select headings by role.
