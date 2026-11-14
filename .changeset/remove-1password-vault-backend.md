---
"tiny-agents": minor
---

Remove the 1Password Connect vault backend. Vault items live in the local backend (sealed with `SECRETS_KEY`), and the `OP_CONNECT_HOST`, `OP_CONNECT_VAULT_ID`, `OP_CONNECT_TOKEN` and `OP_CONNECT_ADMIN_TOKEN` settings are gone.
