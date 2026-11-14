---
"tiny-agents": minor
---

Vault values now live in their own `vault_values` table instead of the key-value store, and an MCP connection's header secret is a vault item. The first start after the update moves every existing value and connection secret over and checks each one before removing the old copy; an entry it can't read stays where it was and is named in the log. The Vault list no longer goes empty when one item can't be read: that item shows as unreadable and the rest list. Every read of an item checks it against its current policy, listing included, and concurrent OAuth sign-in steps no longer overwrite each other.
