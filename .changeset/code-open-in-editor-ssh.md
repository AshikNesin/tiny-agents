---
"tiny-agents": patch
---

Code: Open in editor reaches the local Docker sandbox again. The `~/.ssh/config` entry it suggests now uses `127.0.0.1` instead of `localhost`, which macOS resolves to `::1` first, where the sandbox's port isn't published. Hosts for a sandbox VM or a remote Shelley now carry the `exedev` user, so the editor no longer signs in as your own Mac user.
