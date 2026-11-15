# 0015 — One secrets subsystem: the vault holds the app's own credentials too

- Status: accepted (amends [0005](0005-secrets-live-outside-the-app.md); amended by
  [0019](0019-vault-values-table.md): values in a table, connection header values
  as vault items)
- Date: 2026-11-07
- Issue: #179

## Context

tiny-agents kept secrets in three ways. Bot secrets were vault items (ADR
0005): resolved at a boundary, registered with the redactor, audited.
MCP connection secrets were encrypted columns on `connections`, with a key
taken straight from `sha256(SECRETS_KEY)`, no binding to the row and no way
to rotate. Model provider keys were environment variables. Moving models into
the database (issue #179) needs somewhere to keep provider keys, and adding a
fourth mechanism would mean a fourth set of rules for storage, redaction and
rotation.

## Decision

- **Every secret the app holds is a vault item.** An item has an
  **audience**: `bots` (listed to bots, used through their tools, with
  approvals) or `app` (used by the server itself). `app` items are never
  listed to bots, and a bot's tool that names one gets "no such item".
- **A `provider` sink.** A model provider account's key is an `app` item of
  kind `api_key` whose hosts are the provider's host. The sink resolves it
  through the same use path as every other sink, for a target host the item
  must list. No approval is asked: the owner configured the provider.
- **Audit and caching for `app` items.** Refusals and failures are audited;
  successful uses are not (one row per model call would bury the log). A
  resolved value is kept in memory for up to five minutes, keyed by item and
  host, and dropped when the item is edited or deleted.
- **Local encryption v2** (`apps/web/src/server/crypto/secret-box.ts`), for
  the local backend and connection columns alike: a key per purpose derived
  from `SECRETS_KEY` with HKDF, AES-256-GCM, and the purpose, record and field
  as AAD. A local item is also bound to a digest of its row's policy
  (audience, origins, hosts, injection), so widening an item's hosts in the
  database, rather than through the service (which re-seals), leaves the
  value unreadable. `SECRETS_KEY_PREVIOUS` and `pnpm secrets:rotate` rotate
  the key. The old `v1` format is not read.
- **The Vault page shows `app` items** in a read-only "Used by the app"
  group. Edits and deletes happen where they are used (Settings → Models).

## Consequences

- One resolve, redact, host-check and audit path for every secret, and one
  place later integrations (TinyFish, Pushover) can move their keys to.
- The local backend's values live in the app's SQLite file (the `kv` table),
  sealed with keys derived from `SECRETS_KEY`. A stolen database without the
  key exposes nothing. Someone who can write the database _and_ knows the key
  can still do anything, as before.
- The policy binding protects local items only. A 1Password item's policy
  lives on the row, so database write access can still widen its hosts.
- Changing `SECRETS_KEY` without rotating makes stored secrets unreadable:
  items and connections report it and ask for the value again. Boot never
  fails because of it.

## Alternatives considered

- **Encrypted columns on a `providers` table.** A third place secrets live,
  with its own rotation, redaction and audit.
- **Provider keys in env, as before.** Keeps every key change behind a
  restart and outside the owner's reach.
- **Provider keys required in 1Password.** Makes Connect a hard dependency of
  chatting. It stays a choice per item.
