---
"tiny-agents": patch
---

Adding, deleting or re-pointing an MCP connection (URL, header, secret) now asks you to confirm it's you, as model accounts already did. Moving a connection to another host drops its stored header secret unless you enter a new one, and an app credential can't be used as a connection's header secret.
