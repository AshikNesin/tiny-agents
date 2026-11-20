---
"tiny-agents": patch
---

1Password: the app's own keys (model provider keys, the GitHub App private key and webhook secret) now go to 1Password too, and **Move N local items here** on the Vault page moves the existing ones. The server keeps using the last value it read while Connect is starting or down, and waits a few seconds for a cold Connect, so GitHub webhooks and model calls keep working across a restart. MCP connection secrets stay local.
