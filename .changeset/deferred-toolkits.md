---
"tiny-agents": minor
---

Bots load the tools few chats use (browser, computer, code, attachments, bot builder, self-improve, vault) only when they need them, as pi does: the groups are named in the prompt and loaded with `tool_search`, which saves about 7k tokens on every request that uses none of them. Tool search now comes with every bot that has something to load, not only bots with a large connection.
