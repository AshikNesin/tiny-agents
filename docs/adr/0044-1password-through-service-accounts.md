# 0044 — 1Password through service accounts; Connect is removed

- Status: accepted (supersedes the Connect parts of
  [0027](0027-1password-connect-runs-inside-the-app.md); amends
  [0005](0005-secrets-live-outside-the-app.md))
- Date: 2026-11-23

## Context

ADR 0027 brought the 1Password backend back by running 1Password Connect
inside the app's container: the app pulled `connect-api` and `connect-sync`
from 1Password's images, kept the two executables on the data volume and
supervised them on loopback ports. That avoided a second service, but it is a
layout 1Password does not support, a Connect upgrade is a code change (a
version and four digests), the first start needs the container registry, and
Connect's eventual consistency needed workarounds in the backend (retrying a
fresh item's read, and describing a new item from the create answer for ten
minutes).

ADR 0005 turned down 1Password Service Accounts because they have no REST API
(SDK or CLI only) and have request quotas.

## Decision

- The 1Password backend talks to 1Password through **service accounts** with
  the official JavaScript SDK (`@1password/sdk`). Connect, the bundled
  binaries and every `OP_CONNECT_*` variable are removed. The backend is named
  `onepassword`; a migration renames the `onepassword-connect` rows, so linked
  items keep working.
- **Two service accounts**, both limited to one dedicated vault:
  `OP_SERVICE_ACCOUNT_TOKEN` can only read (bots resolve with it) and
  `OP_SERVICE_ACCOUNT_ADMIN_TOKEN` can read and write (only the Vault page's
  routes load it). `OP_VAULT_ID` is optional, as `OP_CONNECT_VAULT_ID` was.
  With only the read+write token, bots use it too, and new items go to
  1Password whenever the read+write token is set, as before.
- The rest of the 0005/0027 design stays: the scoping guard (the token must
  see exactly the pinned vault, checked before first use and at least every
  6 hours, or every use is refused with `token_overscoped`), the check that
  an item is in the pinned vault, the field mapping (rewritten for the SDK's
  item shape), and the app-value cache with fail-closed uses.
- The SDK computes the current TOTP code; the backend uses it, and computes
  the code from the seed itself when the SDK sends none.

## Consequences

- No second service and no unsupported layout: the SDK is a dependency like
  any other, upgraded through the lockfile. One deploy, two env vars.
- The REST objection in 0005 no longer matters. Every vault access goes
  through the `VaultBackend` port, so whether the transport is REST or an SDK
  is a detail of one module; the app never needed REST for its own sake.
- **Rate limits.** Service accounts have per-token hourly quotas (read and
  write counted apart) and a per-account daily quota, which vary by plan
  (1Password's "Service account rate limits" page has the current numbers).
  A `resolve` runs once per approved use, the scoping guard once per 6 hours
  per token, and listings only when the owner opens the Vault page, so this
  app's usage is far below them. A refused request (HTTP 429) fails that use
  closed with 1Password's message; it is not retried.
- **No offline cache.** Connect kept an encrypted copy of the vault next to
  the app; the SDK asks 1Password's servers each time. When 1Password is
  unreachable, every vault use fails closed. The app's own keys (model
  provider keys, the GitHub App's key and webhook secret) still keep the last
  value the server read for 5 minutes and serve it while 1Password is down.
- The Connect sync-lag workarounds go: a new item is readable as soon as the
  SDK's create returns.
- Service account tokens carry no expiry the app can read, so the Vault card
  no longer warns about one. A token can't see the built-in Personal, Private
  or Employee vaults, so the items bots use must be in a shared vault.
- The SDK's error messages are not a documented contract. The backend sorts
  them into the existing `BackendError` codes by their wording; an unknown
  message is `failed`, with 1Password's text.

## Alternatives considered

- **Keep the bundled Connect server** (0027): works, but stays a layout
  1Password does not support and keeps the binaries, the registry pull and
  the sync-lag workarounds.
- **Connect as a separate service** (compose or another host): the supported
  Connect layout, but it is the second service nobody wanted (0017, 0027).
- **The `op` CLI with a service account**: the same quotas, plus a binary to
  install and a subprocess per use.
