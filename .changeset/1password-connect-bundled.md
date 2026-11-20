---
"tiny-agents": minor
---

Bring back 1Password for the vault, and run 1Password Connect inside the app. Set `OP_CONNECT_CREDENTIALS` to the Connect server's `1password-credentials.json` and `OP_CONNECT_TOKEN` (and `OP_CONNECT_ADMIN_TOKEN` to create and edit items from the Vault page): the app pulls 1Password's pinned Connect binaries onto the data volume on first start and runs them itself, so there is no second service to deploy. `OP_CONNECT_HOST` still points at a Connect server running elsewhere, and `OP_CONNECT_VAULT_ID` is now optional when the token sees one vault. The Vault page shows a 1Password card only once it is set up.
