# Sign in and out

A user signs in with email and password on `/login`, sees a plain-language error for wrong credentials, lands in their chats, and can log out from the account menu, after which every app page sends them back to the login form.

## Sub-features

- `auth-page` shows the login form with the heading `Welcome back`.
- `auth-wrong` rejects bad credentials with the toast `Invalid email or password.` and stays on `/login`.
- `auth-login` signs in and redirects to `/chats` (or `/chats/<botId>`).
- `auth-logout` logs out from the account menu and returns to `/login`.
- `auth-guard` redirects protected pages to `/login` once signed out.

## How to get to it (user POV)

- Open any app URL while signed out, or `/login` directly.
- Log out: the `Account and navigation` button (initials, bottom of the sidebar) → `Log out`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK. The journey runs signed out (`{ signIn: false }`).

- **Login page.** Go to `/login`. Heading `Welcome back` is visible.
- **Wrong password.** Fill `Email` with `demo@example.com`, the `Password` field with anything else, press `Sign In`. Toast `Invalid email or password.`; URL still `/login`; no `Request failed with status code` text.
- **Sign in.** Correct password, `Sign In`. URL matches `/chats(/<id>)?`. Second view: `GET /api/v1/auth/me` is 200 with the demo email.
- **Log out.** Button `Account and navigation` → menuitem `Log out`. URL `/login`.
- **Guard.** Go to `/tasks`. Redirected to `/login`; `GET /api/v1/auth/me` is 401.
- **Proof.** `ta-verify drive $S/journeys/auth.mjs` → `auth/wrong-password`, `auth/signed-in`, `auth/signed-out` (.png + .aria.yml).

## Gotchas

- Login is rate-limited to 20 attempts per 15 minutes per client (doctor and every journey each sign in once). A 429 means wait or relaunch, not a broken login.
- The password field's label matches `/password/i`; use `getByLabel("Email", { exact: true })` for email, since other labels contain "email".
- `/setup` (first-run account creation) is only reachable while no user exists; the seeded run never shows it.
