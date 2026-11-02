---
"@tiny-agents/agent": minor
"@groot/web": patch
---

Bots can ask to enable one of the owner's connections mid-chat. The `self-improve` capability lists the owner's connections that a bot is not linked to in a prompt section. Its new `askOnly` tool, `enable_connection`, links one after the owner approves in chat. The app reconciles the conversation before the tool returns, so the connection's tools work in the same reply. Routine runs and peer deliveries are refused, the same as for `update_instructions`.
