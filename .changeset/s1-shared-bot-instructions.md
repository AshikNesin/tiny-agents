---
"tiny-agents": patch
---

A bot in a chat shared with guests can no longer change its own instructions: `update_instructions` is refused there, as `create_bot` already was, so a guest can't rewrite a shared bot's system prompt by approving the card.
