# First-run setup

On a fresh install with no users, `/login` sends the visitor to `/setup`, where they create the first account (name optional, email, password and confirmation) and are signed in straight away. Once an account exists the page is closed: `/setup` redirects to `/login` and the server refuses a second setup.

## Sub-features

- `setup-redirect` sends `/login` to `/setup` while `GET /api/v1/auth/setup` reports `needsSetup: true`.
- `setup-validation` blocks a malformed email in the browser and shows `Invalid email address`, `Password must be at least 6 characters`, `Passwords do not match`; nothing is created.
- `setup-create` creates the account, toasts `Signed in as <email>.`, lands on `/chats` with the name in the account button.
- `setup-closed` reports `needsSetup: false`, answers a second `POST /api/v1/auth/setup` with 403, and redirects `/setup` to `/login`.
- `setup-login` lets the new account sign in with its password.

## How to get to it (user POV)

- Open any URL of a fresh install (no users): `/login` redirects to `/setup`. Afterwards `/setup` is not reachable.

## Driving it with ta-verify

Preconditions:

- A separate empty run: `ta-verify up --empty --port <free port> --run <id>` (no demo user; doctor checks `GET /api/v1/auth/setup`). The journey declares `requires: ["empty"]` and reports UNREACHABLE (exit 3) on a seeded run. It runs signed out.

- **Redirect.** API `needsSetup: true`. `/login` → URL `/setup`, heading `Create your account`, text `No users exist yet.`.
- **Browser check.** `Email` (exact) = `not-an-email`, `Create account`: the input's `validity.valid` is false and nothing is sent.
- **Form check.** `Email` = `a@b` (passes the browser, fails the schema), `Password` (exact) = `123`, `Confirm password` = `456`, `Create account`. The three messages show; API still `needsSetup: true`.
- **Create.** `Name (optional)` = `Verify Owner <stamp>`, `Email` = `owner-<stamp>@example.com`, matching passwords, `Create account`. Toast `Signed in as …`; URL `/chats`; account button contains the name; `GET /api/v1/auth/me` is that email.
- **Closed.** API `needsSetup: false`; `POST /api/v1/auth/setup` → 403. Log out (account menu) → `/login`; `/setup` → `/login` with `Welcome back`.
- **Login.** Sign in with the new email and password → `/chats`.
- **Proof.** `ta-verify drive $S/journeys/setup.mjs --run <empty id>` → `setup/setup-form`, `setup/setup-validation`, `setup/signed-in`, `setup/setup-closed`.

## Gotchas

- One drive per empty run: the first account cannot be removed, so a second drive finds setup closed. `down` and `up --empty` again to repeat.
- Each instance also binds PORT+1; pick an empty-run port whose neighbour is free.
- Use `getByLabel("Email", { exact: true })`: the FeedbackBee embed adds an `Email (optional)` field to every page.
- A type=email input shows the browser's own bubble for `not-an-email` (not in the ARIA tree); the schema messages appear only for addresses the browser accepts.
