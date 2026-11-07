---
"tiny-agents": minor
---

Stored secrets use a new at-rest format (issue #179, slice 1).

- **Per-purpose keys.** Local vault items and MCP connection secrets are sealed with AES-256-GCM under keys derived from `SECRETS_KEY` with HKDF, one per purpose.
- **Bound to their record.** The purpose, record and field are the AAD, so a value copied to another item, row or column doesn't decrypt.
- **Rotation.** `SECRETS_KEY_PREVIOUS` opens values written under the old key, and `pnpm secrets:rotate` re-seals them under the new one.
- **Breaking.** Values stored in the old `v1` format are not read: re-enter local vault items and connection header secrets, and sign connections in to OAuth again.
