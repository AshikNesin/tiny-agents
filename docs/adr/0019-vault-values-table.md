# 0019 — Vault values live in a table, opened under their row's policy; connection header values are vault items

- Status: accepted (amends [0015](0015-one-secrets-subsystem.md) and
  [0017](0017-local-is-the-only-vault-backend.md))
- Date: 2026-11-14
- Rewrite: Q4, register rows C11 and S11, plan step 4.4

## Context

ADR 0017 left every vault value in the `local` backend, which kept each item
in the KV store (`VAULT_LOCAL:<id>`, `{policy, sealed}`) and the list of ids
in a hand-kept `VAULT_LOCAL:__index`. Two problems came with it:

- **C11.** Creating or deleting an item rewrote the index with a
  read-modify-write and no lock, so two at once could lose one; a connection's
  OAuth state was written the same way. The listing opened every item with
  `Promise.all`, so one unreadable item emptied the Vault's "Not linked yet"
  list.
- **S11.** Each entry stored the policy digest it was sealed under beside the
  ciphertext. Resolve, reveal and the item page opened the value under the
  digest of its `vault_items` row, but the listing and an unlinked describe
  opened it under the stored digest, so a row whose policy was widened in the
  database still listed its item's metadata.

ADR 0015 also kept a connection's header value as a third kind of stored
secret (`connections.secret_enc`), outside the vault's resolve, audit and
reveal paths.

## Decision

- **A `vault_values` table**, one row per local item: `id` (the
  `externalId`), `sealed`, `policy` (the digest in the AAD) and timestamps.
  Writes are one statement or one synchronous transaction (R7); there is no
  index. The listing names an item that won't open instead of failing.
- **Same primitives.** AES-256-GCM with the HKDF-derived `vault-local` key, and
  the same AAD (purpose, id, field `item`, policy digest), so values sealed
  before move without being re-encrypted.
- **The row is the authority (S11).** Every read opens an item under the
  digest of the `vault_items` row that links it, and the stored digest must
  equal it; only an item no row links opens under its stored digest, which the
  AAD makes tamper-evident. The backend port no longer takes a digest from its
  caller on reads: the backend works it out, so no path can pass the stored
  one. A re-seal runs in the transaction that writes the row
  (`rebind(id, writeRow)`): the item is opened under the row as that
  transaction finds it and sealed under the row `writeRow` returns, so a
  concurrent edit is never sealed over. A value already linked can't be linked
  by a second row, checked in the same transaction.
- **What the digest covers.** Audience, origins, hosts and injection: where a
  value may go. It does not cover the bots, tools, approval, unattended or
  on/off columns (as before Q4), so someone who can write the database can
  widen those without breaking the seal. The digest is unchanged here; that
  gap is recorded for the owner.
- **A connection's header value is a vault item** (Q4): its own `mcp-<slug>`
  API key (tool `mcp`, no bots), linked from `connections.secret_item_id` and
  written and deleted with the connection. It goes only to the hosts it lists:
  a connect checks the URL's host as a `host` use. A host move without a new
  value deletes it (S4), and a new value resets its policy columns.
  `secretRef` still names another item and wins over it. The HTTP API and its
  wire shapes are unchanged. OAuth state stays on the row, changed in one
  transaction.
- **A start-time data move.** `importStoredSecrets()` copies every
  `VAULT_LOCAL:` KV entry into the table byte for byte, reads it back, then
  deletes the KV entry; and turns each `secret_enc` into the connection's own
  item, checked and cleared in one transaction. What it can't move stays where
  it was and is logged. It is idempotent and never fails boot. The KV copies
  are removed once moved, so a deleted item or a rotated key leaves no second
  copy behind.

## Consequences

- One place holds every local value, and every read of one checks its policy.
  Database write access can no longer widen an item's reach or reveal its
  metadata without `SECRETS_KEY`; with the key, as before, it can do anything.
- The Vault page lists connection header values as API keys, with the same
  reveal, rotate and audit as any item. Deleting one there is refused (409);
  it goes with its connection.
- `connections.secret_enc` is read only by the import. A later release can drop
  it, and the `VAULT_LOCAL:` namespace, once every install has started on Q4.
- A KV entry the import can't parse stays in KV until the owner removes it; it
  was unreadable before Q4 too.

## Alternatives considered

- **The policy itself in the value row, as the authority.** Two places would
  hold an item's policy, and the service checks targets against the
  `vault_items` columns; one of the two would drift.
- **Keep KV, lock the index.** Fixes the race but not the trusted sidecar
  digest, and keeps a hand-kept index next to a database that has tables.
- **Re-encrypt on import.** Not needed: the AAD is unchanged. A byte copy can
  be verified exactly and can't turn a readable value unreadable.
