---
"tiny-agents": patch
---

Code: thread titles, branch names and PR titles are a short summary again when the default model is a Claude plan model. Titles and memory capture now fall back to a model a side call can run (the bot's, the default, or the first API model), instead of a Claude plan model that made the call skip and left the task's first words (#382).
