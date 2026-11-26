---
"tiny-agents": minor
---

The 1Password vault backend now talks to 1Password through service accounts, with 1Password's JavaScript SDK, instead of 1Password Connect. The bundled Connect server is gone, and so are the `OP_CONNECT_*` variables and the Vault card's **Starting** state. To keep using 1Password, create two service accounts limited to one dedicated vault, one read-only and one read and write, set `OP_SERVICE_ACCOUNT_TOKEN` and `OP_SERVICE_ACCOUNT_ADMIN_TOKEN` (and `OP_VAULT_ID` if you pinned one), remove the old `OP_CONNECT_*` variables and redeploy. Items already linked to 1Password keep working: migration 0039 renames their backend from `onepassword-connect` to `onepassword`. There is no local copy of the vault any more, so vault uses fail closed while 1Password is unreachable. See ADR 0044.
