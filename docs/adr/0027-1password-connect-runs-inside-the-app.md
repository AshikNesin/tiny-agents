# 0027 — 1Password Connect comes back, and runs inside the app's container

- Status: accepted (amends [0005](0005-secrets-live-outside-the-app.md) and
  [0017](0017-local-is-the-only-vault-backend.md))
- Date: 2026-11-20

## Context

ADR 0017 removed the 1Password Connect backend because no deployment ran
Connect: it is two more containers (`connect-api` and `connect-sync`) to host
beside the app, and nobody wanted a second service just for the vault. The
owner now wants vault items in 1Password, without that second service. The
app deploys as one container (Railpack on Coolify), built from the repo, with
no Dockerfile or compose file of its own.

## Decision

- Restore the Connect backend behind the existing `VaultBackend` port, with
  the scoping guard, the two tokens and the field mapping of ADR 0005.
  `OP_CONNECT_VAULT_ID` becomes optional: unset, the pin is the one vault the
  token sees, and a token that sees more is refused as before. With only the
  read+write token, bots use it too; the docs say why a separate read token is
  better. New items go to 1Password when the read+write token is set; the
  app's own credentials and connection secrets stay local. _Amended:_ the
  app's own credentials (model provider keys, the GitHub App key and webhook
  secret) follow the new items and can be moved, because the owner wants every
  secret in 1Password. A key the server read stays usable while Connect is
  down, and a cold Connect gets a retry window shorter than GitHub's webhook
  timeout. MCP connection secrets stay local.
- **Bundle Connect in the app's container.** With `OP_CONNECT_CREDENTIALS`
  (the `1password-credentials.json` contents) and no `OP_CONNECT_HOST`, the
  app supervises both Connect processes itself: it pulls 1Password's images
  from `ghcr.io/1password` at a pinned version and per-CPU manifest digest,
  verifies every blob, keeps only the two executables on the data volume,
  and runs them on fixed loopback ports with the bus wired by
  `OP_BUS_PORT`/`OP_BUS_PEERS`, restarting either on exit. The credentials
  reach the processes through `OP_SESSION` in their environment only.
- The Vault page shows a 1Password card only when Connect is configured, with
  a **Starting** state while the bundled server comes up.

## Consequences

- One deploy, three env vars (`OP_CONNECT_CREDENTIALS` and the two tokens),
  no second service.
- The credentials file and the tokens live on one host. ADR 0005 preferred a
  separate Connect host so that neither compromise hands over both; that
  layout is still available through `OP_CONNECT_HOST`.
- Running Connect's binaries outside its images is not a layout 1Password
  supports. The binaries are the ones in the images, and the bus setup is the
  one 1Password documents for hosts without broadcast. A Connect upgrade is a
  code change (the version and four digests in `connect-image.ts`).
- The first start needs the registry (about 40 MB to pull, once per Connect version); until
  Connect answers, vault uses fail closed and the card says why.
- Connect can't bind to loopback only, so its ports are reachable inside the
  container's network. Every call needs a token; the ports are not published.
- Linux on amd64 or arm64 only; elsewhere use `OP_CONNECT_HOST`.

## Alternatives considered

- **A compose deployment** (the app plus 1Password's two images, one Coolify
  resource): the layout 1Password supports, but it moves the app off
  Railpack onto a Dockerfile and compose file of its own and still runs three
  containers. Worth it if the bundled server proves fragile.
- **Copying the binaries into the image at build time.** Railpack has no
  multi-stage copy from another image, and every deploy would carry 75 MB of
  binaries whether 1Password is used or not.
- **1Password Service Accounts** (no Connect at all): SDK or CLI only, no REST,
  rate limited, as ADR 0005 found.
