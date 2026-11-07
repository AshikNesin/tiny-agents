---
"tiny-agents": minor
"@tiny-agents/agent": minor
---

Vault items have an audience (issue #179, slice 2; ADR 0015).

- **`app` items.** A secret the server uses itself, such as a model provider's key. Bots never list or use it; only the new `provider` sink resolves it, for a host the item lists. Successful uses aren't audited, and the value is cached in memory for up to five minutes.
- **Policy binding.** A local item is bound to a digest of its policy (audience, origins, hosts, injection). Edits through the Vault UI re-seal it; widening an item's hosts in the database directly leaves its value unreadable.
- **Vault page.** App items appear under "Used by the app" and can't be edited or deleted there.
- **Breaking.** Local vault items stored before this change don't open: re-enter them.
