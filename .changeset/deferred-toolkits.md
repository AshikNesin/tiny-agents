---
"tiny-agents": minor
---

Bots load the browser and computer tools only when they need them, as pi does: the tools are named in the prompt and loaded with `tool_search`, which saves about 5k tokens on every request that does not use them. Tool search now comes with every bot that has something to load, not only bots with a large connection.
