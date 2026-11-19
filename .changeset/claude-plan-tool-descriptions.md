---
"tiny-agents": patch
---

Bots on the Claude plan read the same tool descriptions and parameter details as other bots, and are no longer offered tools that are not set up. A connection's tool descriptions are cut to 2,048 characters, as Claude Code does, since every request re-sends them.
