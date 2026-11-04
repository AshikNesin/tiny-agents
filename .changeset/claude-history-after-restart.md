---
"@tiny-agents/agent": patch
---

Keep a Claude Code chat's history across a server restart. The runtime synced the conversation before the engine had read `agent.db.claude.json`, so the empty in-memory session shadowed the saved transcript (and the next save overwrote the file). The engine now merges the saved transcript and resume id into an already-synced session, reads the file before it ever writes it, and loads it before serving a chat watcher.
