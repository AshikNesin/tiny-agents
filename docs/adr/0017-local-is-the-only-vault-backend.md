# 0017 — Local is the only vault backend; the 1Password Connect adapter is removed

- Status: accepted (amends [0005](0005-secrets-live-outside-the-app.md); amended by
  [0019](0019-vault-values-table.md): the local backend keeps its values in a table;
  amended by [0027](0027-1password-connect-runs-inside-the-app.md): the 1Password
  Connect backend is back, with Connect bundled in the app)
- Date: 2026-11-13

## Context

ADR 0005 made 1Password, read through a self-hosted Connect server, the
primary home of vault values, with the `local` backend as a fallback. No
deployment runs Connect: every item lives in the `local` backend. The adapter
(two tokens, a scoping guard, a field mapping, its fake server and tests) was
code to maintain with no user.

## Decision

- Remove the 1Password Connect backend, its `OP_CONNECT_*` env vars and its
  UI. `local` (values sealed with `SECRETS_KEY` in the app's KV store) is the
  only backend.
- Keep the `VaultBackend` port and the `backend` column, so an external
  manager can come back behind the same seam without a schema change.
- The rest of 0005 stands: handles only, resolve at the sink, policy and
  approval, the redactor and credential requests.

## Consequences

- The app's SQLite file now holds every vault value, sealed. A stolen
  database without `SECRETS_KEY` exposes nothing; losing the key loses the
  values (see the vault guide's Local section).
- Rotating a value happens in the Vault UI only.
- Bringing back an external manager means a new adapter behind the port and
  a new ADR.

## Alternatives considered

- **Keep the adapter unused.** It costs upkeep and tests for a path no one
  exercises, and dead paths rot.
